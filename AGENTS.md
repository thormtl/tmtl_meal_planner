# AGENTS.md: setting up and running tmtl_meal_planner

Guide for an AI agent (Claude Code, Codex, Copilot, …) that sets up or maintains this project for a human.
Read it fully before acting.

## What this project is

A weekly **dinner plan for a Danish family**, built from this week's **BilkaToGo** offers and recipes:

1. **Plan:** a scheduled agent on the human's Mac builds 7 dinners with 3 swaps each (quick, child-friendly,
   varied, using the offers), plus weekly basics. It publishes them to GitHub Pages (`docs/`).
2. **Choose:** the human picks dinners on the page, often on a phone, and taps **Gem indkøbsliste**. That
   downloads a JSON shopping list (`tmtl-meal-planner/grocery-list@1`).
3. **Cart:** the human saves the list in a Google Drive folder (`Madplan/inbox`). A watcher on the Mac fills the
   BilkaToGo cart and writes a receipt to `Madplan/done`.
4. **Pay:** the human checks the cart on bilkatogo.dk, chooses a delivery time and pays.

Store access goes through [handle-mcp](https://github.com/NJohansen/handle-mcp), pinned to `1.8.0`. It is unofficial,
uses the store's private web APIs, and **cannot order or pay**.

## Hard rules (non-negotiable)

1. **The repo is public. Never commit personal or sensitive data:**
   - names, emails, phone, CPR or addresses;
   - household details;
   - local paths, Drive paths, usernames;
   - tokens, cookies, keys or session data;
   - shopping lists or receipts.

   Household settings live in `~/.config/tmtl_meal_planner/`, outside the repo.
2. **Never bypass the safety gate.** No `--no-verify`, no editing `scripts/scan_sensitive.py` or the denylist to make
   a commit pass. If the hook blocks a commit, remove the sensitive content.
3. **Commit with a no-reply identity:** the author email must be `<id>+<login>@users.noreply.github.com`, and the
   author name must not be a real name (`scripts/install-hooks.sh` sets both).
4. **Never order, pay or book a delivery time,** in code or in a browser. Only fill the cart, and only from a list the
   human chose.
5. **The human handles credentials and macOS permissions.** The human types the store password in
   `handle-mcp login` (it is saved in the macOS keychain) and clicks macOS privacy prompts. An agent never sees,
   types or stores a password.
6. **Telemetry off:** `HANDLE_TELEMETRY=0` everywhere handle-mcp runs.
7. Store data only: never invent dishes, prices or offers.

## Prerequisites (macOS)

- `uv` (runs handle-mcp via `uvx`), `python3` (3.9+, standard library only), `git`, `gh` (logged in), `gitleaks`
  (`brew install gitleaks`).
- Claude Code CLI (`claude`), logged in, for the weekly agent.
- Google Drive for desktop (the synced Drive folder), for the list → cart hand-off.
- A BilkaToGo account with home delivery.

## Setup (in order)

| # | Who | Step |
|---|---|---|
| 1 | agent | Clone or fork the repo. Run `scripts/install-hooks.sh`: activates the scan hooks and sets the no-reply author. |
| 2 | human | Add personal terms (names, address, email, phone) to `~/.config/tmtl_meal_planner/denylist.txt`, one per line. Agents must not write the human's personal data anywhere else. |
| 3 | agent | `python3 -m planner.config --init`: writes `~/.config/tmtl_meal_planner/config.json`. Set `persons`, `basics` (Danish search words + quantity), and `inbox` / `done` (two folders inside the human's synced Google Drive folder, e.g. `…/Madplan/inbox` and `…/Madplan/done`). |
| 4 | human | `uvx handle-mcp@1.8.0 login bilkatogo`: types the password; the session goes to the keychain. |
| 5 | agent | Smoke test (read-only): `python3 -m planner.build_plan` must write `docs/plan.json` with 7 days. |
| 6 | agent | `scripts/build_watcher_app.sh`: builds `~/Applications/Madplan Watcher.app` (osacompile, no Xcode) and the launchd watcher. |
| 7 | human | On the watcher's first run, macOS asks: *"Madplan Watcher" would like to access files in Google Drive*. Click **Allow**. That grants Google Drive only; **never grant Full Disk Access**. |
| 8 | agent | `python3 scripts/install_weekly_agent.py`: the weekly agent runs Saturday 12:00 by default (`--weekday 0-6 --hour --minute`). |
| 9 | agent | Enable GitHub Pages from `main` / `docs`, plus secret scanning and push protection on the repo. |
| 10 | both | End-to-end test: open the page, save a list into `inbox`, and check that a receipt appears in `done`. This fills the real cart, so the human decides. |

## How the parts fit

| Path | Role |
|---|---|
| `planner/mcp.py` | Minimal stdio MCP client for handle-mcp (pinned version, telemetry off). |
| `planner/build_plan.py` | Collects Bilka recipes, prices them per person, scores and picks the week (small bonus for dishes with a real photo). Adds normal prices and savings, and a real dish photo from the public recipe page (`page_photo`, https://www.bilkatogo.dk/ only, no login) when the recipe data has none. Writes `docs/plan.json` and the archive `docs/plans/<week>.json` + `index.json`. |
| `planner/favourites.py` | Scoring words: `KID` (Danish children's favourites), `AVOID`, `FAMILY` (variety), `STAPLES` (pantry items, bought once). |
| `planner/fill_cart.py` | Validates a list (schema, ids, qty 0-20) and sets absolute cart quantities, 50 per call. Writes the receipt. |
| `docs/` | The static page (`index.html`, `app.js`, `style.css`, `img/`, self-hosted OFL fonts in `fonts/`). Nothing is sent anywhere; choices are kept in the browser. |
| `prompts/weekly_meal_plan.md` | The weekly agent's instructions and review checklist. |
| `scripts/weekly_agent.sh` | Runs `claude -p` with that prompt and a least-privilege tool allowlist; logs to `~/Library/Logs/`. |
| `scripts/scan_sensitive.py`, `.githooks/pre-commit`, `.github/workflows/scan.yml` | The safety gate (gitleaks + personal-data scan), locally and in CI. |

## Troubleshooting

- **Watcher log says "cannot read the inbox (PermissionError)":** macOS privacy (TCC) blocks background access to
  the Drive folder. Rebuild with `scripts/build_watcher_app.sh` and have the human click Allow. `Path.glob` hides
  this error, which is why the code uses `os.listdir`.
- **A login error from the builder or the watcher:** the store session expired. The human runs
  `uvx handle-mcp@1.8.0 login bilkatogo` again.
- **The hook blocks a commit:** read the message, remove the personal or sensitive content, and commit again.
- **Phone layout checks:** headless Chrome won't render narrower than about 500 px, so screenshot at 500 px.
- **Updating handle-mcp:**
  1. Review the upstream diff (code, network hosts, telemetry).
  2. Run the egress check (all requests go only to store hosts with `HANDLE_TELEMETRY=0`).
  3. Bump the pin in `planner/mcp.py`, `prompts/`, `scripts/` and this file together.
