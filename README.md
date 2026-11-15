# tmtl_meal_planner

A weekly dinner plan for a Danish family, built from this week's **BilkaToGo** offers and recipes. Pick your
dinners on your phone, save the shopping list, and your Mac fills the BilkaToGo cart. You check the cart and pay.

**Prototype.** BilkaToGo only. Store access goes through [handle-mcp](https://github.com/NJohansen/handle-mcp)
1.8.0 (unofficial, reviewed, telemetry off), which can fill a cart but can never order or pay.

## How it works

1. **Plan** (your Mac): `python3 -m planner.build_plan --publish`
   - Reads Bilka's weekly "Madplan" plus its dinner recipes.
   - Scores them on how likely children are to like them (`planner/favourites.py`), the share of the cost
     that's on offer this week, and how quick they are to cook.
   - Picks 7 dinners with 3 swaps each and adds your weekly basics.
   - Publishes `docs/plan.json` to GitHub Pages.
2. **Choose** (any device): open the Pages site. Tap a swap per day, tick basics and pantry items, then press
   **Gem indkøbsliste**. That downloads `bilkatogo-liste-<week>.json`. Save it in your Google Drive
   `Madplan/inbox` folder.
3. **Cart** (your Mac): a launchd watcher (`scripts/build_watcher_app.sh`) sees the file and runs
   `planner.fill_cart`, which sets the cart quantities. It writes a receipt (`*.kvittering.md`) to `Madplan/done`.
4. **Pay** (you): open https://www.bilkatogo.dk/kurv, choose a delivery time and pay.

The list file is meant for agents too: its `how_to_use` field explains exactly what to do with it.

## Setup (once)

```sh
brew install gitleaks
scripts/install-hooks.sh               # scan hooks + GitHub no-reply author email + personal denylist file
python3 -m planner.config --init       # ~/.config/tmtl_meal_planner/config.json: persons, basics, Drive folders
uvx handle-mcp@1.8.0 login bilkatogo   # your login, saved in the macOS keychain
scripts/build_watcher_app.sh          # after setting inbox/done in the config (see Watcher access)
```

## HARD GATE: nothing personal, nothing secret

This repo is **public**. Every commit runs two scans:
- **gitleaks** for secrets.
- **`scripts/scan_sensitive.py`** for emails, Danish phone and CPR numbers, street addresses, home-folder and
  Drive paths, session tokens and forbidden files, plus your personal denylist in
  `~/.config/tmtl_meal_planner/denylist.txt` (outside the repo).

The commit is also refused unless the author email is a GitHub no-reply address. CI runs the same scans
on every push (`.github/workflows/scan.yml`).

Household details, local paths, shopping lists and receipts live only on your Mac or in your Drive, never in git.

## Watcher access (macOS)

macOS doesn't let background jobs read the Google Drive folder. Instead of Full Disk Access, the watcher runs
through a tiny app, `Madplan Watcher.app`, built without Xcode by `osacompile` plus an ad-hoc signature:

```sh
scripts/build_watcher_app.sh   # builds ~/Applications/Madplan Watcher.app and installs the launchd watcher
```

The first time it runs, macOS asks: **"Madplan Watcher" would like to access files in Google Drive**. Click
**Allow**. That grants Google Drive only, never the whole disk. A rebuild changes the signature, so macOS asks again.
The log is `~/Library/Logs/tmtl_meal_planner.log`.
