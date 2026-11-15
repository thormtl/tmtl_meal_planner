#!/bin/sh
# Weekly meal-plan agent: runs Claude Code headless with prompts/weekly_meal_plan.md (installed by
# scripts/install_weekly_agent.py as a launchd job). Least privilege: only the tools the prompt needs are allowed;
# everything else is denied because a headless run cannot ask. Output goes to ~/Library/Logs/tmtl_meal_planner_weekly.log
# and a local macOS notification (nothing is sent anywhere else).
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 1
export HANDLE_TELEMETRY=0
echo "=== $(date '+%Y-%m-%d %H:%M') weekly meal-plan agent ==="
claude -p "$(cat prompts/weekly_meal_plan.md)" \
  --permission-mode default \
  --allowedTools \
    "Read" "Grep" "Glob" \
    "Edit(planner/favourites.py)" \
    "Bash(python3 -m planner.build_plan)" \
    "Bash(git status:*)" "Bash(git diff:*)" "Bash(git log:*)" \
    "Bash(git add docs/plan.json docs/plans)" "Bash(git add planner/favourites.py)" \
    "Bash(git commit -m:*)" "Bash(git push)" \
    "Bash(gh run list:*)" "Bash(gh run view:*)" "Bash(gh run watch:*)" "Bash(gh api repos/:*)" \
  --disallowedTools "Bash(git push --force:*)" "Bash(git push -f:*)" "Bash(git commit --no-verify:*)" \
    "Bash(git commit -n:*)" "Bash(curl:*)" "Bash(rm:*)" "Write" \
  --output-format text
status=$?
if [ $status -eq 0 ]; then msg="Ugens madplan er bygget. Se loggen for rapporten."; else msg="Madplan-agenten fejlede (kode $status). Se loggen."; fi
osascript -e "display notification \"$msg\" with title \"Madplan\"" >/dev/null 2>&1 || true
echo "=== exit $status ==="
exit $status
