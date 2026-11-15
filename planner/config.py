"""Local settings. They live OUTSIDE the repo (~/.config/tmtl_meal_planner/config.json), so household
details and local paths are never committed. `python3 -m planner.config --init` writes a starter file."""
from __future__ import annotations

import json
import pathlib
import sys

DIR = pathlib.Path.home() / ".config" / "tmtl_meal_planner"
FILE = DIR / "config.json"
DEFAULT = {
    "persons": 4,
    "days": 7,
    "alternatives": 3,
    "max_minutes": 45,
    # weekly basics: search text (Danish, as you'd type it at bilkatogo.dk) and how many
    "basics": [
        {"search": "letmælk", "qty": 4},
        {"search": "rugbrød", "qty": 2},
        {"search": "smør", "qty": 1},
        {"search": "æg", "qty": 1},
        {"search": "bananer", "qty": 6},
        {"search": "agurk", "qty": 2},
    ],
    # Google Drive (desktop app) folders for the list -> cart hand-off; set your own paths
    "inbox": "",
    "done": "",
}


def load() -> dict:
    cfg = dict(DEFAULT)
    if FILE.exists():
        cfg.update(json.loads(FILE.read_text(encoding="utf-8")))
    return cfg


if __name__ == "__main__" and "--init" in sys.argv:
    DIR.mkdir(parents=True, exist_ok=True)
    if FILE.exists():
        sys.exit(f"exists: {FILE}")
    FILE.write_text(json.dumps(DEFAULT, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("wrote", FILE)
