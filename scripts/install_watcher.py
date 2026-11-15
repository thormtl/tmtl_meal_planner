#!/usr/bin/env python3
"""Install the macOS launchd agent that fills the BilkaToGo cart when a list lands in the Drive inbox.

  scripts/build_watcher_app.sh                  # builds Madplan Watcher.app, then calls this with --app
  python3 scripts/install_watcher.py --remove

launchd watches the inbox and OPENS "Madplan Watcher.app", which runs planner.fill_cart. Going through an app lets
macOS grant it only "files in Google Drive" (one Allow prompt), never Full Disk Access.
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


def main() -> None:
    uid = os.getuid()
    subprocess.run(["launchctl", "bootout", f"gui/{uid}/{LABEL}"], capture_output=True)
    if "--remove" in sys.argv:
        PLIST.unlink(missing_ok=True); print("removed"); return
    if "--app" not in sys.argv:
        sys.exit("run scripts/build_watcher_app.sh (it builds the app and installs the watcher)")
    app = sys.argv[sys.argv.index("--app") + 1]
    cfg = config.load()
    if not cfg["inbox"] or not cfg["done"]:
        sys.exit("set inbox and done in ~/.config/tmtl_meal_planner/config.json first")
    pathlib.Path(cfg["inbox"]).mkdir(parents=True, exist_ok=True)
    pathlib.Path(cfg["done"]).mkdir(parents=True, exist_ok=True)
    PLIST.write_bytes(plistlib.dumps({
        "Label": LABEL,
        "ProgramArguments": ["/usr/bin/open", "-g", "-a", app],  # -g: stay in the background
        "WatchPaths": [cfg["inbox"]],
        "StandardOutPath": str(LOG), "StandardErrorPath": str(LOG),
        "ThrottleInterval": 15,
    }))
    subprocess.run(["launchctl", "bootstrap", f"gui/{uid}", str(PLIST)], check=True)
    print(f"watching the Drive inbox -> {LABEL} -> {pathlib.Path(app).name} (log: ~/Library/Logs/{LOG.name})")


if __name__ == "__main__":
    main()
