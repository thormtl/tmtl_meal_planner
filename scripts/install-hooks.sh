#!/bin/sh
# One-time setup per clone: activate the scan hooks and the GitHub no-reply author email.
set -e
cd "$(git rev-parse --show-toplevel)"
git config core.hooksPath .githooks
chmod +x .githooks/*
id_login=$(gh api user --jq '"\(.id)+\(.login)"' 2>/dev/null || true)
if [ -n "$id_login" ]; then
  git config user.email "$id_login@users.noreply.github.com"
  git config user.name "${id_login#*+}"   # GitHub login, not your real name (public repo)
fi
echo "hooks active (core.hooksPath=.githooks); author email: $(git config user.email)"
mkdir -p "$HOME/.config/tmtl_meal_planner"
[ -f "$HOME/.config/tmtl_meal_planner/denylist.txt" ] || {
  printf '# Personal terms that must never be committed (one per line): names, address, email, phone...\n' \
    > "$HOME/.config/tmtl_meal_planner/denylist.txt"
  echo "created ~/.config/tmtl_meal_planner/denylist.txt: add your personal terms"
}
