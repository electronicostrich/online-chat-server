#!/usr/bin/env bash
# Claude Code SessionStart hook — prints branch, open contract questions, and CLAUDE.md hard constraints.
# See docs/hooks.md §3 for the full reference.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

BRANCH="$(git branch --show-current 2>/dev/null || echo 'unknown')"

printf '\n=== Claude Code session start ===\n'
printf 'Branch: %s\n\n' "$BRANCH"

if [ -f docs/traceability.md ]; then
  printf '=== Open contract questions (from traceability.md) ===\n'
  grep -nE '^Note:|Resolve before|not yet in' docs/traceability.md 2>/dev/null | head -20 || printf '(none)\n'
  printf '\n'
fi

if [ -f CLAUDE.md ]; then
  printf '=== CLAUDE.md §6 Hard constraints ===\n'
  awk '/^## 6\. Hard constraints/,/^## 7\./' CLAUDE.md 2>/dev/null | head -30
fi

printf '\n(This hook is informational only; it does not block anything.)\n\n'
exit 0
