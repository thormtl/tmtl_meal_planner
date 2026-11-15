#!/bin/sh
# Build ~/Applications/Madplan Watcher.app (no Xcode: osacompile + ad-hoc codesign) and point the launchd watcher at it.
# The app runs the cart filler; macOS asks once "Madplan Watcher would like to access files in Google Drive".
# Rebuilding changes the signature, so macOS asks again.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
APP="$HOME/Applications/Madplan Watcher.app"
LOG="$HOME/Library/Logs/tmtl_meal_planner.log"
TMP=$(mktemp -d)
sed -e "s|__ROOT__|$ROOT|" -e "s|__LOG__|$LOG|" "$ROOT/scripts/watcher_app.applescript" > "$TMP/w.applescript"
mkdir -p "$HOME/Applications"
rm -rf "$APP"
osacompile -o "$APP" "$TMP/w.applescript"
rm -rf "$TMP"
P="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier dk.tmtl.madplanwatcher" "$P" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string dk.tmtl.madplanwatcher" "$P"
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$P" 2>/dev/null || true   # no Dock icon
codesign --force --deep --sign - "$APP"
echo "built: $APP"
python3 "$ROOT/scripts/install_watcher.py" --app "$APP"
