#!/usr/bin/env bash
# Claude Code PreToolUse hook for Bash — rejects dangerous commands before they run.
# See docs/hooks.md §3.1 for the full rule reference.
# Exit code 2 means "blocked"; 0 means "allow".
set -uo pipefail

# The hook receives the tool_use payload as JSON on stdin.
PAYLOAD="$(cat)"

# Extract the command. Use python3 for robust JSON parsing.
CMD="$(printf '%s' "$PAYLOAD" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command",""))' 2>/dev/null || echo "")"

block() {
  printf 'BLOCKED by .claude/settings.json: %s\n' "$1" >&2
  printf 'See docs/ai-development-guardrails.md and docs/hooks.md §3 for the rule.\n' >&2
  exit 2
}

# Rule 1 — no --no-verify
if printf '%s' "$CMD" | grep -qE 'git[[:space:]]+(commit|push|merge|rebase)[[:space:]].*--no-verify'; then
  block '--no-verify is forbidden (docs/ai-development-guardrails.md §4.4).'
fi

# Rule 2 — no banned schema libs
if printf '%s' "$CMD" | grep -qE 'pnpm[[:space:]]+(add|install|i)[[:space:]].*\b(zod|yup|joi|ajv)\b'; then
  block 'TypeBox is the only schema library (ADR-010). Do not install zod/yup/joi/ajv.'
fi

# Rule 3 — no rm -rf against root or home
if printf '%s' "$CMD" | grep -qE 'rm[[:space:]]+-[rRf]+[[:space:]]+(/|~|\$HOME|\$\{HOME\})([[:space:]]|$|/)'; then
  block 'rm -rf against root or $HOME is forbidden. Use a specific path.'
fi

# Rule 4 — destructive SQL only in test paths
if printf '%s' "$CMD" | grep -qiE '(DROP TABLE|TRUNCATE|DROP COLUMN|DROP DATABASE|DROP SCHEMA)\b'; then
  # Allow if the command explicitly references test paths / the drift_check DB name
  if ! printf '%s' "$CMD" | grep -qE 'apps/api/test/|drift_check|_bootstrap_sentinel'; then
    block 'Destructive SQL outside test paths requires an infra/ branch and PR review (docs/ai-development-guardrails.md §5.5).'
  fi
fi

# Rule 5 — do not edit .claude/settings.json or lefthook.yml via shell
if printf '%s' "$CMD" | grep -qE '(^|[[:space:]>])(echo|cat|tee|printf)[[:space:]]+.*[[:space:]>]+\.claude/settings\.json'; then
  block 'Edit .claude/settings.json via the Edit tool on an infra/ branch, not via shell redirection.'
fi
if printf '%s' "$CMD" | grep -qE '(^|[[:space:]>])(echo|cat|tee|printf)[[:space:]]+.*[[:space:]>]+lefthook\.yml'; then
  block 'Edit lefthook.yml via the Edit tool on an infra/ branch, not via shell redirection.'
fi

# Rule 6 — no force push to main or develop
if printf '%s' "$CMD" | grep -qE 'git[[:space:]]+push[[:space:]].*--force'; then
  if printf '%s' "$CMD" | grep -qE '(\bmain\b|\bdevelop\b|origin/(main|develop))'; then
    block 'Force push to main or develop is forbidden (docs/git-workflow.md §11).'
  fi
fi

exit 0
