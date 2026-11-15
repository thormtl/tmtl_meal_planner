#!/usr/bin/env python3
"""Install the weekly meal-plan agent as a macOS launchd job (default: Saturday 12:00 local time).

  python3 scripts/install_weekly_agent.py                     # Saturday 12:00
  python3 scripts/install_weekly_agent.py --weekday 0 --hour 9  # Sunday 09:00 (0/7 = Sunday, 6 = Saturday)
  python3 scripts/install_weekly_agent.py --remove

Runs on this Mac (not in the cloud) because building the plan uses the BilkaToGo login in the macOS keychain.
If the Mac is asleep at the scheduled time, launchd runs the job when it wakes. The plist is written OUTSIDE the repo.
"""
import argparse
import os
import pathlib
import plistlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
LABEL = "dk.tmtl.mealplanner.weekly"
PLIST = pathlib.Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
LOG = pathlib.Path.home() / "Library" / "Logs" / "tmtl_meal_planner_weekly.log"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weekday", type=int, default=6); ap.add_argument("--hour", type=int, default=12)
    ap.add_argument("--minute", type=int, default=0); ap.add_argument("--remove", action="store_true")
    a = ap.parse_args()
    uid = os.getuid()
    subprocess.run(["launchctl", "bootout", f"gui/{uid}/{LABEL}"], capture_output=True)
    if a.remove:
        PLIST.unlink(missing_ok=True); print("removed"); return
    claude = shutil.which("claude")
    if not claude:
        sys.exit("Claude Code CLI not found on PATH (install it and log in first)")
    path = ":".join(dict.fromkeys([str(pathlib.Path(claude).parent), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]))
    PLIST.write_bytes(plistlib.dumps({
        "Label": LABEL,
        "ProgramArguments": ["/bin/sh", str(ROOT / "scripts" / "weekly_agent.sh")],
        "WorkingDirectory": str(ROOT),
        "StartCalendarInterval": {"Weekday": a.weekday, "Hour": a.hour, "Minute": a.minute},
        "EnvironmentVariables": {"PATH": path, "HANDLE_TELEMETRY": "0"},
        "StandardOutPath": str(LOG), "StandardErrorPath": str(LOG),
    }))
    subprocess.run(["launchctl", "bootstrap", f"gui/{uid}", str(PLIST)], check=True)
    days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    print(f"weekly agent: every {days[a.weekday]} {a.hour:02d}:{a.minute:02d} -> {LABEL} (log: ~/Library/Logs/{LOG.name})")


if __name__ == "__main__":
    main()
