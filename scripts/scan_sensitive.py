#!/usr/bin/env python3
"""HARD GATE: block personal data (PII), secrets and local paths from this public repo.

  python3 scripts/scan_sensitive.py --staged   # pre-commit: staged files + the commit author
  python3 scripts/scan_sensitive.py --all      # every tracked file (CI)

Runs next to gitleaks (generic secret detection). This adds what gitleaks does not look for:
emails, Danish phone/CPR numbers, street addresses, home-folder paths, store session tokens, forbidden files,
and a PERSONAL DENYLIST kept outside the repo (~/.config/tmtl_meal_planner/denylist.txt, one term per line:
your names, children's names, address, email...). Exit 1 = commit/push blocked.
"""
from __future__ import annotations

import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
DENYLIST = pathlib.Path.home() / ".config" / "tmtl_meal_planner" / "denylist.txt"
NOREPLY = re.compile(r"^\d+\+[A-Za-z0-9-]+@users\.noreply\.github\.com$")
ALLOWED_EMAILS = {"noreply@github.com"}

RULES = [
    ("email address", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    ("Danish phone number", re.compile(r"(?:\+45|0045)[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{2}\b"
                                       r"|(?i:tlf|telefon|mobil|phone)\.?:?\s*\d{2}\s?\d{2}\s?\d{2}\s?\d{2}\b")),
    ("CPR number", re.compile(r"\b(?:0[1-9]|[12]\d|3[01])(?:0[1-9]|1[0-2])\d{2}-?\d{4}\b")),
    ("street address", re.compile(r"\b[A-ZÆØÅ][a-zæøå]+(?:vej|gade|allé|alle|vænge|vænget|stræde|torv|parken|bakken|"
                                  r"høj|haven|stien|boulevard)\s+\d{1,4}[A-Za-z]?\b")),
    ("home-folder path", re.compile(r"/Users/[^/\s\"']+|/home/[^/\s\"']+|[A-Za-z]:\\\\?Users\\\\")),
    ("Google Drive path", re.compile(r"GoogleDrive-|CloudStorage/|Mit drev|My Drive")),
    ("token / session", re.compile(r"(?i)\b(?:login_token|session_token|refresh_token|access_token|id_token|"
                                   r"authorization:\s*bearer|set-cookie|gigya[_-]?(?:token|session)|glt_|gac_)\b"
                                   r"|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.")),
    ("private key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
]
FORBIDDEN_FILES = re.compile(r"(?i)(^|/)(\.env(\..*)?|.*\.pem|.*\.key|.*\.p12|id_[rd]sa.*|config\.json|denylist\.txt|"
                             r".*kvittering.*|.*receipt.*|.*\.fejl\.md|bilkatogo-liste-.*\.json|cookies?.*)$")
SELF = {"scripts/scan_sensitive.py"}  # holds the patterns themselves


def git(*a: str) -> str:
    return subprocess.run(["git", "-C", ROOT, *a], capture_output=True, text=True, check=True).stdout


def files(staged: bool) -> list[tuple[str, str]]:
    names = git("diff", "--cached", "--name-only", "--diff-filter=ACMR").split() if staged else git("ls-files").split()
    out = []
    for n in names:
        try:
            text = git("show", f":{n}") if staged else (ROOT / n).read_text(encoding="utf-8")
        except (UnicodeDecodeError, subprocess.CalledProcessError, FileNotFoundError):
            text = ""
        out.append((n, text))
    return out


def denylist() -> list[str]:
    if not DENYLIST.exists():
        return []
    return [t.strip().lower() for t in DENYLIST.read_text(encoding="utf-8").splitlines()
            if t.strip() and not t.startswith("#") and len(t.strip()) >= 3]


def main() -> int:
    staged = "--staged" in sys.argv
    problems: list[str] = []
    if staged:
        email = git("config", "user.email").strip()
        if not NOREPLY.match(email):
            problems.append("commit author email is not a GitHub no-reply address "
                            "(run: git config user.email <id>+<login>@users.noreply.github.com)")
    deny = denylist()
    if staged:
        author = git("config", "user.name").strip().lower()
        if any(t in author for t in deny):
            problems.append("commit author name contains a denylisted personal term (run: git config user.name <github-login>)")
    if not deny and os.environ.get("CI") != "true":
        print(f"warning: no personal denylist at {DENYLIST} (add your names, address, email)", file=sys.stderr)
    for name, text in files(staged):
        if FORBIDDEN_FILES.search(name):
            problems.append(f"{name}: forbidden file type for this repo")
        if name in SELF:
            continue
        low = text.lower()
        for term in deny:
            if term in low:
                problems.append(f"{name}: contains a denylisted personal term")
        for no, line in enumerate(text.splitlines(), 1):
            for label, rx in RULES:
                for m in rx.finditer(line):
                    if label == "email address" and (m.group(0) in ALLOWED_EMAILS or m.group(0).endswith("@users.noreply.github.com")):
                        continue
                    problems.append(f"{name}:{no}: {label}")
    if problems:
        print("BLOCKED by scan_sensitive (personal data / secrets must never enter this public repo):", file=sys.stderr)
        for p in sorted(set(problems)):
            print("  -", p, file=sys.stderr)
        return 1
    print("scan_sensitive: clean", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
