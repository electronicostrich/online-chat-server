#!/usr/bin/env bash
# Claude Code PreToolUse hook for Write/Edit — rejects dangerous content before it lands on disk.
# See docs/hooks.md §3.1 and docs/ai-development-guardrails.md §5.1 for the full rule reference.
# Exit code 2 means "blocked"; 0 means "allow".
set -uo pipefail

PAYLOAD="$(cat)"

read -r FILE CONTENT <<<"$(printf '%s' "$PAYLOAD" | python3 -c '
import sys, json
d = json.load(sys.stdin)
ti = d.get("tool_input", {})
file = ti.get("file_path", "")
# Write uses "content"; Edit uses "new_string".
content = ti.get("content") or ti.get("new_string") or ""
# Escape newlines so we can pass it on a single line, then we unescape.
content_esc = content.replace("\\", "\\\\").replace("\n", "\\n")
print(f"{file}\t{content_esc}")
' 2>/dev/null || echo "")"

# The heredoc approach above doesn't quite work. Use a different split strategy:
PARSED="$(printf '%s' "$PAYLOAD" | python3 -c '
import sys, json
d = json.load(sys.stdin)
ti = d.get("tool_input", {})
file = ti.get("file_path", "")
content = ti.get("content") or ti.get("new_string") or ""
# Use a rare separator; JSON payload itself contains no FS characters.
print(file)
print("---FS-BOUNDARY---")
print(content)
' 2>/dev/null || echo "")"

FILE="$(printf '%s\n' "$PARSED" | sed -n '1p')"
CONTENT="$(printf '%s\n' "$PARSED" | sed -n '/^---FS-BOUNDARY---$/,$p' | tail -n +2)"

block() {
  printf 'BLOCKED by .claude/settings.json: %s\n' "$1" >&2
  printf 'See docs/ai-development-guardrails.md §5.1 and docs/hooks.md §3 for the rule.\n' >&2
  exit 2
}

# Allowlist: certain files intentionally carry the forbidden patterns (docs, hooks themselves).
if printf '%s' "$FILE" | grep -qE '(docs/|\.claude/|scripts/claude-hooks/|lefthook\.yml|eslint\.config\.|/pre-commit|test/|\.spec\.|\.test\.)'; then
  exit 0
fi

# Only scan source-like files.
if ! printf '%s' "$FILE" | grep -qE '\.(ts|tsx|js|jsx|mjs|cjs)$'; then
  exit 0
fi

# Rule 1 — eslint-disable
if printf '%s' "$CONTENT" | grep -qE '//[[:space:]]*eslint-disable(-next-line|-line)?\b'; then
  block 'eslint-disable on new content. If genuinely needed, add TODO(#N) linking an issue and open the rule-weakening PR separately.'
fi

# Rule 2 — @ts-ignore / @ts-nocheck
if printf '%s' "$CONTENT" | grep -qE '@ts-(ignore|nocheck)\b'; then
  block '@ts-ignore and @ts-nocheck are forbidden. Use @ts-expect-error with a 10+ character description.'
fi

# Rule 3 — as any / as unknown as
if printf '%s' "$CONTENT" | grep -qE '\bas[[:space:]]+any\b|\bas[[:space:]]+unknown[[:space:]]+as\b'; then
  block '"as any" / "as unknown as" are forbidden on new lines (guardrails §5.1).'
fi

# Rule 4 — console.* in apps/api/src
if printf '%s' "$FILE" | grep -qE '(^|/)apps/api/src/'; then
  if printf '%s' "$CONTENT" | grep -qE '\bconsole\.(log|warn|error|info|debug|trace)\b'; then
    block 'console.* in apps/api/src/. Use the Pino logger.'
  fi
fi

# Rule 5 — banned schema-lib imports
if printf '%s' "$CONTENT" | grep -qE "^[[:space:]]*import[[:space:]].*from[[:space:]]+['\"](zod|yup|joi|ajv)['\"]"; then
  block 'TypeBox is the only schema library (ADR-010). Do not import zod/yup/joi/ajv.'
fi

# Rule 6 — bare TODO without issue number
if printf '%s' "$CONTENT" | grep -qE '\bTODO[[:space:]]*:[[:space:]]' && ! printf '%s' "$CONTENT" | grep -qE '\bTODO[[:space:]]*\(#[0-9]+\)'; then
  block 'Bare TODO is forbidden. Use TODO(#N): ... with an issue number.'
fi

exit 0
