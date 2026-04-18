#!/usr/bin/env bash
# Claude Code Stop hook — refuses to end the session if the workspace is broken.
# See docs/hooks.md §3.1 and the PO-approved strictness decision in docs/git-workflow.md.
# Exit code 2 means "blocked" (session cannot end); 0 means "ok to end".
set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

BRANCH="$(git branch --show-current 2>/dev/null || echo '')"

# Pre-bootstrap: if there is no package.json yet (repo is just docs), skip.
if [ ! -f package.json ]; then
  printf 'Stop hook: no package.json yet (pre-bootstrap). Skipping checks.\n'
  exit 0
fi

# Spike branches: relax to typecheck + lint only.
SPIKE=0
if printf '%s' "$BRANCH" | grep -qE '^spike/'; then
  SPIKE=1
  printf 'Stop hook: spike branch — skipping doc-consistency.\n'
fi

printf 'Stop hook: running typecheck...\n'
if ! pnpm typecheck >/tmp/stop-typecheck.log 2>&1; then
  tail -40 /tmp/stop-typecheck.log >&2
  printf '\nSTOP BLOCKED: typecheck failed. Fix TypeScript errors before ending the session.\n' >&2
  exit 2
fi
printf 'Stop hook: typecheck ok.\n'

printf 'Stop hook: running lint...\n'
if ! pnpm lint >/tmp/stop-lint.log 2>&1; then
  tail -40 /tmp/stop-lint.log >&2
  printf '\nSTOP BLOCKED: lint failed. Fix ESLint errors before ending the session.\n' >&2
  exit 2
fi
printf 'Stop hook: lint ok.\n'

if [ "$SPIKE" -eq 0 ]; then
  printf 'Stop hook: running doc-consistency...\n'
  if ! pnpm doc-consistency >/tmp/stop-doc.log 2>&1; then
    tail -40 /tmp/stop-doc.log >&2
    printf '\nSTOP BLOCKED: doc-consistency failed. Fix doc/code drift before ending the session.\n' >&2
    exit 2
  fi
  printf 'Stop hook: doc-consistency ok.\n'
fi

printf 'Stop hook: all checks passed. Session may end.\n'
exit 0
