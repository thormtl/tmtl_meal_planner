#!/usr/bin/env python3
"""Install the macOS launchd agent that fills the BilkaToGo cart when a list lands in the Drive inbox.

  python3 scripts/install_watcher.py            # writes + loads ~/Library/LaunchAgents/dk.tmtl.mealplanner.fill.plist
  python3 scripts/install_watcher.py --remove

The plist (with your local paths) is written OUTSIDE the repo. Folders come from ~/.config/tmtl_meal_planner/config.json.
"""
import os
import pathlib
import plistlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from planner import config  # noqa: E402

LABEL = "dk.tmtl.mealplanner.fill"
PLIST = pathlib.Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
LOG = pathlib.Path.home() / "Library" / "Logs" / "tmtl_meal_planner.log"
# A dedicated interpreter, so the macOS Full Disk Access grant (needed to read Google Drive from a background job)
# covers only this watcher, not every Python on the Mac. Create it: README "Watcher access (macOS)".
PY = pathlib.Path.home() / ".local" / "share" / "tmtl_meal_planner" / "python" / "bin" / "python3.12"


def main() -> None:
    uid = os.getuid()
    subprocess.run(["launchctl", "bootout", f"gui/{uid}/{LABEL}"], capture_output=True)
    if "--remove" in sys.argv:
        PLIST.unlink(missing_ok=True); print("removed"); return
    cfg = config.load()
    if not cfg["inbox"] or not cfg["done"]:
        sys.exit("set inbox and done in ~/.config/tmtl_meal_planner/config.json first")
    pathlib.Path(cfg["inbox"]).mkdir(parents=True, exist_ok=True)
    pathlib.Path(cfg["done"]).mkdir(parents=True, exist_ok=True)
    PLIST.write_bytes(plistlib.dumps({
        "Label": LABEL,
        "ProgramArguments": [str(PY if PY.exists() else "/usr/bin/python3"), "-m", "planner.fill_cart", "--inbox"],
        "WorkingDirectory": str(ROOT),
        "WatchPaths": [cfg["inbox"]],
        "EnvironmentVariables": {"PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", "HANDLE_TELEMETRY": "0"},
        "StandardOutPath": str(LOG), "StandardErrorPath": str(LOG),
        "ThrottleInterval": 15,
    }))
    subprocess.run(["launchctl", "bootstrap", f"gui/{uid}", str(PLIST)], check=True)
    print(f"watching the Drive inbox -> {LABEL} (log: ~/Library/Logs/{LOG.name})")
    print(f"macOS: System Settings > Privacy & Security > Full Disk Access > + > {PY if PY.exists() else '/usr/bin/python3'}")


if __name__ == "__main__":
    main()
