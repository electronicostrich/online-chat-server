#!/bin/bash
# Spawns a fresh git worktree + Claude Code session per workstream ID.
# Each worktree lives in ../online-chat-server-worktrees/<ws-id-lower>/ on
# a new branch feature/<WS-ID>-autorun-<YYYYMMDD> off origin/develop.
#
# Usage:
#   ./scripts/spawn-workstream-windows.sh [--dry-run] [--force] WS-01 WS-02 ...
#
# --dry-run: print actions, no side effects
# --force:   bypass dependency gate (for testing)
#
# See docs/overnight-autonomous-run.md for the full flow.

set -u

DRY_RUN=0
FORCE=0
WS_IDS=()

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --force)   FORCE=1   ;;
    -h|--help)
      sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      # Strictly validate workstream IDs: WS- then exactly two digits.
      # Anything else (including WS-1 or WS-01extra or WS-01'evil) is rejected.
      # This closes a shell-injection path: these IDs flow into command strings.
      if [[ "$arg" =~ ^WS-[0-9]{2}$ ]]; then
        WS_IDS+=("$arg")
      else
        echo "Unknown arg or invalid workstream ID: $arg (expected WS-NN)" >&2
        exit 2
      fi
      ;;
  esac
done

if [[ ${#WS_IDS[@]} -eq 0 ]]; then
  echo "Usage: $0 [--dry-run] [--force] WS-01 WS-02 ..." >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKTREE_PARENT="$(cd "$PROJECT_DIR/.." && pwd)/online-chat-server-worktrees"
SETTINGS_LOCAL="$PROJECT_DIR/.claude/settings.local.json"
WORKSTREAMS_DOC="$PROJECT_DIR/docs/workstreams/proposed-workstreams.md"
DEP_MAP="$PROJECT_DIR/docs/workstreams/workstream-dependency-and-interface-map.md"
PROMPT_DIR="/tmp"
SPAWN_LOG="$HOME/.claude/cc-optimizer/spawn-log.jsonl"
DATE_TAG=$(date +%Y%m%d)

fail() { echo "ERROR: $*" >&2; exit 1; }

# `run_dry` is a thin wrapper for dry-run echoing ONLY. Callers pass a
# descriptive string; real execution is inlined at the call site using
# an argv array (never `eval`) to avoid shell-injection via variable
# interpolation of externally-derived values (branch names, paths, etc.).
dry_log() { echo "DRY: $*"; }

[[ -f "$WORKSTREAMS_DOC" ]] || fail "workstreams doc not found at $WORKSTREAMS_DOC"
[[ -f "$SETTINGS_LOCAL" ]] || fail "settings.local.json not found at $SETTINGS_LOCAL — create it before spawning"

CODE_BIN=""
for c in /opt/homebrew/bin/code /usr/local/bin/code; do
  [[ -x "$c" ]] && CODE_BIN="$c" && break
done

CLAUDE_BIN=""
for c in /opt/homebrew/bin/claude /usr/local/bin/claude "$HOME/.claude/local/claude"; do
  [[ -x "$c" ]] && CLAUDE_BIN="$c" && break
done
[[ -n "$CLAUDE_BIN" ]] || fail "claude CLI not found — install it or adjust PATH"

if [[ "$DRY_RUN" -eq 0 ]]; then
  mkdir -p "$WORKTREE_PARENT"
  mkdir -p "$(dirname "$SPAWN_LOG")"
fi

generate_starter_prompt() {
  local ws_id="$1"
  local out="$2"
  local ws_lower
  ws_lower=$(echo "$ws_id" | tr '[:upper:]' '[:lower:]')
  cat > "$out" <<PROMPT_EOF
You are working ONLY on workstream $ws_id. Do not touch other workstreams' files.

Before starting:
1. Read CLAUDE.md \u00a76 (hard constraints) and docs/ai-development-guardrails.md \u00a75 and \u00a711.
2. Read ONLY the rows in docs/traceability.md that match AC IDs for $ws_id.
3. Read the $ws_id paragraph in docs/workstreams/proposed-workstreams.md. Skip other paragraphs.
4. Read the $ws_id section of docs/workstreams/workstream-dependency-and-interface-map.md to understand what your workstream produces and consumes.

Scope discipline:
- You may ONLY edit files that belong to $ws_id. If you are unsure whether a file belongs to your workstream, stop and write the question to docs/workstream-notes/${ws_lower}-blockers.md.
- Before running \`docker compose up\`, run \`docker compose ps\`. If services are already running, reuse them \u2014 do NOT start a second instance.
- If a git command fails with a lock error (\".git/index.lock\"), wait 5 seconds and retry once. Other workstream worktrees may be writing concurrently.

Work rhythm:
- One AC at a time. After each AC is delivered, commit with message format \"<AC-ID>: <what>\" and push to origin.
- After your FIRST commit on this branch, open a DRAFT PR to develop. The PR title and body MUST match the formats enforced by scripts/check-pr-description.ts and docs/git-workflow.md §4.1:
  Title must start with one of: \`AC-<ID>:\`, \`chore:\`, \`fix:\`, \`doc:\`, \`infra:\`, \`spike:\` (or uppercase equivalents). For a multi-AC workstream PR, use the primary AC as the prefix:
    AC-<PRIMARY-ID>: <short human summary> (${ws_id} autorun)
  Body MUST include at minimum H2 sections \`## Summary\` and \`## Testing\`.
  Use this template:
    gh pr create --draft --base develop --head feature/${ws_id}-autorun-${DATE_TAG} --label autorun \\
      --title "AC-<PRIMARY-ID>: <short summary> (${ws_id} autorun)" \\
      --body "## Summary

<one or two sentences describing what this workstream delivers>.

## Testing

<how ACs are exercised: which Playwright specs, which unit/integration tests, and any manual verification>.

## AC IDs addressed
- <AC-ID>: <name> (\\\`<spec path>\\\`)

## Docs updated
- <docs/* files touched and why>

## Destructive-migration disclosure
<None, or list destructive SQL operations and link to the migration file>"
  The \`autorun\` label is what the cascade coordinator watches for. Each push re-triggers CodeRabbit + CI.
- After each commit, update docs/traceability.md with the completion note for that AC row.
- If you are not 100% certain about an AC, interpretation, API contract, or product decision: STOP. Do not guess. Write the question to docs/workstream-notes/${ws_lower}-blockers.md, commit+push that note, open the draft PR with a format-compliant title that carries the BLOCKED marker — the title must still pass \`check-pr-title\`. Use the pattern: \`chore: BLOCKED — ${ws_id} — <short reason>\` (the \`chore:\` prefix satisfies the format check). Then add the \`blocked\` label: \`gh pr edit <num> --add-label blocked\`. The Stop hook recognizes that label and lets you exit cleanly. The cascade coordinator also skips blocked-labeled PRs. End your turn with a clear "BLOCKED: <why>" message.
- maxTurns=80. Near the cap, commit in-progress work cleanly and STOP rather than leaving a change mid-way.

End-of-workstream polish phase (MANDATORY before ending the session):
1. After your last AC is delivered and pushed, wait ~5 minutes so CodeRabbit has time to post its review.
2. Fetch review state: \`gh pr view <num> --json reviews\`. Fetch threads: \`gh api graphql -f query='{repository(owner:\"electronicostrich\",name:\"online-chat-server\"){pullRequest(number:<num>){reviewThreads(first:100){nodes{id isResolved isOutdated path line comments(first:1){nodes{url body}}}}}}}'\`
3. Classify every unresolved, non-outdated thread by severity:
   - **Major / Potential-issue** = must-fix before merge: address (commit + push) OR reply with explicit rationale AND resolve the thread via \`mutation { resolveReviewThread(input: { threadId: "<id>" }) { thread { id } } }\`.
   - **Minor / Nitpick / Trivial** = may defer: EITHER resolve inline OR file a GitHub issue labeled \`deferred-stage-2\` with title \`CR follow-up (${ws_id} PR #<num>): <file> — <heading>\` and body pointing to the comment URL. Then resolve the thread.
4. Repeat the fetch-address-push loop until CodeRabbit's latest review is APPROVED or every thread is either resolved or filed-as-issue.
5. Mark the PR ready (remove draft): \`gh pr ready <num>\`.
6. Post the cascade-ready marker as a PR comment: \`gh pr comment <num> --body "<!-- autorun: ready-for-merge -->"\`.
7. Only THEN end your session cleanly. Do not merge the PR yourself \u2014 cascade coordinator or a human handles merge.

NOTE: develop branch protection no longer requires all conversations resolved to merge (we flipped it off intentionally), so a few unresolved nit-threads won't block auto-merge. But your polish phase MUST still file every unresolved thread as either a tracked issue or an in-thread resolution so nothing gets lost.

Context preservation:
- Use the Explore subagent for broad codebase searches. Don't dump raw search results into your main context.
- Write interim findings into docs/workstream-notes/${ws_lower}-progress.md, not your head.
- After each AC is delivered, consider /compact to start the next AC on fresh context.

You are now in charge. Begin.
PROMPT_EOF
}

check_dependencies() {
  local ws_id="$1"
  if [[ ! -f "$DEP_MAP" ]]; then
    echo "WARN: dependency map missing at $DEP_MAP \u2014 skipping dependency check"
    return 0
  fi
  # Look for "depends on" lines near the ws_id section. Heuristic only.
  local deps
  deps=$(awk -v target="$ws_id" '
    BEGIN { in_section=0 }
    /^#+/ {
      if ($0 ~ target) { in_section=1 } else if (in_section==1) { in_section=0 }
    }
    in_section==1 && /[Dd]epend/ { print }
  ' "$DEP_MAP" | grep -oE 'WS-[0-9]+' | sort -u | grep -v "^${ws_id}$")

  if [[ -z "$deps" ]]; then
    echo "no declared dependencies for $ws_id"
    return 0
  fi

  echo "$ws_id depends on: $(echo $deps | tr '\n' ' ')"

  if [[ "$FORCE" -eq 1 ]]; then
    echo "  (\u2014\u2014force bypasses dependency gate)"
    return 0
  fi

  local trace_doc="$PROJECT_DIR/docs/traceability.md"
  local unmet=()
  for dep in $deps; do
    # Heuristic 1: a commit on origin/develop mentions the dep.
    local merged
    merged=$(cd "$PROJECT_DIR" && git log origin/develop --oneline --grep="$dep" 2>/dev/null | head -1)
    if [[ -n "$merged" ]]; then
      continue
    fi
    # Heuristic 2: traceability.md has a line where the dep ID appears
    # ON THE SAME LINE as a completion-ish status keyword. Same-line anchoring
    # prevents false positives when a neighboring row carries a status word.
    # Catches the case where the work was delivered under a different AC family
    # than the WS-ID (e.g., WS-01 delivered via AC-BOOT-00 in Phase 0).
    if [[ -f "$trace_doc" ]] && \
       grep -iE "${dep}.*(implemented|delivered|complete|landed|merged|✅|✓)|(implemented|delivered|complete|landed|merged|✅|✓).*${dep}" \
         "$trace_doc" >/dev/null 2>&1; then
      echo "  $dep satisfied via traceability.md completion marker (same-line)"
      continue
    fi
    unmet+=("$dep")
  done

  if [[ ${#unmet[@]} -gt 0 ]]; then
    echo "UNMET dependencies: ${unmet[*]}"
    echo "Rerun with --force to bypass (for testing), or wait for those workstreams to land on develop."
    return 1
  fi
  return 0
}

spawn_one() {
  local ws_id="$1"
  local ws_lower
  ws_lower=$(echo "$ws_id" | tr '[:upper:]' '[:lower:]')
  local worktree_path="$WORKTREE_PARENT/$ws_lower"
  local branch="feature/${ws_id}-autorun-${DATE_TAG}"
  local prompt_file="$PROMPT_DIR/cc-starter-${ws_lower}.md"

  echo
  echo "=== Spawning $ws_id ==="

  # 1. Validate existence — require a proper section heading, not a loose
  # mention in a "Consumes" or "Key integration points" line.
  if ! grep -qE "^#+\s+.*${ws_id}" "$WORKSTREAMS_DOC"; then
    echo "SKIP: $ws_id has no dedicated section heading in $WORKSTREAMS_DOC"
    return 1
  fi

  # 2. Dependency check
  if ! check_dependencies "$ws_id"; then
    return 1
  fi

  # 3. Worktree creation
  if [[ -d "$worktree_path" ]]; then
    echo "SKIP: worktree already exists at $worktree_path (remove first with: git worktree remove $worktree_path)"
    return 1
  fi
  if (cd "$PROJECT_DIR" && git rev-parse --verify "$branch" >/dev/null 2>&1); then
    echo "SKIP: branch $branch already exists (delete first with: git branch -D $branch)"
    return 1
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "DRY: cd '$PROJECT_DIR' && git worktree add -b '$branch' '$worktree_path' origin/develop"
  else
    if ! (cd "$PROJECT_DIR" && git worktree add -b "$branch" "$worktree_path" origin/develop); then
      echo "FAIL: git worktree add for $ws_id failed — aborting this spawn (no Terminal will open)"
      return 1
    fi
  fi

  # 4. Copy settings.local.json (fail loudly if this can't happen)
  if [[ "$DRY_RUN" -eq 0 ]]; then
    if ! cp "$SETTINGS_LOCAL" "$worktree_path/.claude/settings.local.json"; then
      echo "FAIL: could not copy settings.local.json into $worktree_path — aborting"
      (cd "$PROJECT_DIR" && git worktree remove --force "$worktree_path") 2>/dev/null
      return 1
    fi
  fi

  # Helper: tear down the worktree + branch on fail-fast so a partial spawn
  # doesn't leave garbage. Use inside the real-run error paths below.
  rollback_worktree() {
    local reason="$1"
    echo "FAIL ($reason) — rolling back worktree + branch for $ws_id" >&2
    (cd "$PROJECT_DIR" && git worktree remove --force "$worktree_path") 2>/dev/null
    (cd "$PROJECT_DIR" && git branch -D "$branch") 2>/dev/null
  }

  # 5. lefthook install in worktree (best-effort; not fatal if missing)
  if [[ -f "$worktree_path/lefthook.yml" || -f "$worktree_path/lefthook.yaml" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      dry_log "(cd $worktree_path && lefthook install)"
    else
      (cd "$worktree_path" && lefthook install >/dev/null 2>&1) || true
    fi
  fi

  # 6. Generate starter prompt — fatal if this fails.
  if [[ "$DRY_RUN" -eq 1 ]]; then
    dry_log "would write starter prompt to $prompt_file"
  else
    if ! generate_starter_prompt "$ws_id" "$prompt_file"; then
      rollback_worktree "starter prompt generation failed"
      return 1
    fi
  fi

  # 7. Log spawn — fatal if this fails.
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local log_entry
  if ! log_entry=$(jq -cn \
    --arg ts "$ts" \
    --arg ws "$ws_id" \
    --arg wt "$worktree_path" \
    --arg br "$branch" \
    '{ts: $ts, ws_id: $ws, worktree_path: $wt, branch: $br}' 2>&1); then
    [[ "$DRY_RUN" -eq 0 ]] && rollback_worktree "jq log entry failed: $log_entry"
    return 1
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    dry_log "append to $SPAWN_LOG: $log_entry"
  else
    if ! printf '%s\n' "$log_entry" >> "$SPAWN_LOG"; then
      rollback_worktree "spawn-log append failed"
      return 1
    fi
  fi

  # 8. Open a Terminal window that runs the claude CLI with the starter prompt on stdin.
  # Using `open -a Terminal <file>` avoids macOS AppleEvent (osascript) automation perms.
  local launcher_sh="/tmp/cc-launch-${ws_lower}.sh"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    dry_log "would write $launcher_sh and run: open -a Terminal $launcher_sh"
  else
    if ! cat > "$launcher_sh" <<LAUNCH_EOF
#!/bin/bash
cd "$worktree_path"
echo "=== Claude Code session for $ws_id ==="
echo "Worktree: $worktree_path"
echo "Branch: $branch"
echo "Prompt file: $prompt_file"
echo "Permission mode: bypassPermissions (via settings.local.json defaultMode)"
echo
"$CLAUDE_BIN" < "$prompt_file"
echo
echo "=== Session ended. Window stays open. ==="
exec \$SHELL
LAUNCH_EOF
    then
      rollback_worktree "launcher script write failed"
      return 1
    fi
    if ! chmod +x "$launcher_sh"; then
      rollback_worktree "launcher chmod failed"
      return 1
    fi
    if ! open -a Terminal "$launcher_sh"; then
      rollback_worktree "open -a Terminal failed"
      return 1
    fi
  fi

  echo "Spawned $ws_id in $worktree_path"
}

FAILURES=0
for ws in "${WS_IDS[@]}"; do
  if ! spawn_one "$ws"; then
    FAILURES=$((FAILURES + 1))
  fi
done

echo
if [[ "$FAILURES" -eq 0 ]]; then
  echo "All ${#WS_IDS[@]} workstream(s) spawned."
else
  echo "$FAILURES of ${#WS_IDS[@]} spawn(s) failed. See output above."
  exit 1
fi
