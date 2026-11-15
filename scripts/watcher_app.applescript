-- Madplan Watcher: fills the BilkaToGo cart from shopping lists in the Google Drive inbox.
-- A tiny app so macOS can grant it ONLY "files in Google Drive" (no Full Disk Access).
-- Built by scripts/build_watcher_app.sh, which replaces __ROOT__ and __LOG__ with local paths (never committed).
on run
	do shell script "export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin HANDLE_TELEMETRY=0; cd " & quoted form of "__ROOT__" & " && /usr/bin/python3 -m planner.fill_cart --inbox >> " & quoted form of "__LOG__" & " 2>&1"
end run
