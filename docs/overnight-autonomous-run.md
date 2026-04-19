# Overnight autonomous run — runbook

This document describes how to run online-chat-server workstreams autonomously while you sleep. The system has multiple Claude Code sessions each working on one workstream in its own git worktree, plus a cascade coordinator that auto-merges green PRs and spawns dependents.

## Pre-flight checklist (10 min)

1. Land any in-flight Phase 0 / feature work to develop.
2. Update develop: `git checkout develop && git pull`.
3. Confirm lefthook is installed: `lefthook install`.
4. Confirm CI is green on develop (GitHub Actions `ci.yml`).
5. Confirm `.claude/settings.local.json` exists in the project (gitignored — won't be in repo). If missing, pull it from a teammate or recreate per the template in §6 below.
6. Confirm the cascade coordinator plist is loaded: `launchctl list | grep cascade-coordinator`.
7. Decide which workstreams to run tonight. See `docs/workstreams/proposed-workstreams.md` and `docs/workstreams/workstream-dependency-and-interface-map.md`. Only spawn workstreams whose dependencies are already on develop.

## Launching

```bash
./scripts/spawn-workstream-windows.sh WS-01 WS-02
```

- Each workstream gets a new worktree at `../online-chat-server-worktrees/<ws-id-lower>/`.
- Each worktree runs on a fresh branch `feature/<WS-ID>-autorun-<YYYYMMDD>` off `origin/develop`.
- Each opens a new Terminal window with `claude` CLI already running the starter prompt.
- Each spawn is logged to `~/.claude/cc-optimizer/spawn-log.jsonl`.

### Launcher flags

- `--dry-run`: print intended actions, no side effects. Run this first on any new setup.
- `--force`: bypass the dependency gate (only for testing).

### Per-workstream starter prompt

The launcher generates a prompt at `/tmp/cc-starter-<ws-id>.md`. It instructs the session to:

- Read CLAUDE.md §6, the guardrails, traceability.md AC rows, and the workstream's paragraph.
- Stick strictly to files that belong to its workstream.
- Commit per AC, push, update traceability.md.
- Open a draft PR labeled `autorun` after the first commit.
- Enter a mandatory polish phase after the last AC: address CodeRabbit comments, mark ready, post `<!-- autorun: ready-for-merge -->` marker.
- Stop cleanly if uncertain or near `maxTurns: 80`.

## Safety nets active

1. **Project `.claude/settings.local.json`**: `bypassPermissions` + `maxTurns: 80` + deny list blocking destructive operations, pushes to main/develop, `--no-verify`, sudo, etc.
2. **Global hooks** (`~/.claude/hooks/block-rm-rf.sh`, `block-push-main.sh`): catch hook-level attempts.
3. **Project hooks** (`scripts/claude-hooks/pre-tool-use-bash.sh`): additional project-specific filtering.
4. **Pre-commit lefthook**: blocks `as any`, `@ts-ignore`, `console.*` in api/src, schema changes without migrations, secrets via gitleaks.
5. **Branch protection**: main and develop refuse force-push, require PR reviews.
6. **GitHub Actions CI** (`.github/workflows/ci.yml`): typecheck, lint, unit, integration, schema-drift, doc-consistency, build, Playwright E2E (Chromium + WebKit).
7. **CodeRabbit**: reviews each PR push. Blocking feedback must be addressed before merge.
8. **Cascade coordinator safety** (see §5): conservative merge criteria, max 4 merges/hour, kill switch, never touches main.

Four fences on the outer side (deny list, global hooks, project hooks, pre-commit), two on the inner side (CI, CodeRabbit).

## Deviation audit — risks and preemption

| # | Risk | Preemption |
|---|------|------------|
| 1 | Scope creep across workstreams | Starter prompt scopes allowed files. Morning digest flags cross-workstream file edits. |
| 2 | Contract breakage (TypeBox schema edit breaks consumer) | `pnpm schema-drift` pre-commit + CI job. Digest flags schemas touched by multiple worktrees. |
| 3 | Dependency violation (WS-04 starts before WS-03 lands) | Launcher dependency gate. `--force` only for testing. |
| 4 | Runaway fix-loop | `maxTurns: 80`. Stop hook notification fires when cap hit. |
| 5 | Silent "done" without real completion | Starter prompt requires updating traceability.md per AC. Digest cross-checks. |
| 6 | Secrets committed | gitleaks pre-commit. |
| 7 | Port collision on `docker compose` | Starter prompt: `docker compose ps` check before starting. |
| 8 | Hallucinated APIs/paths | `tsc` in pre-commit + CI typecheck. |
| 9 | Cross-worktree contention on develop | No auto-merge from session (cascade coordinator is the only auto-merger, with strict criteria). |
| 10 | Context compaction mid-workstream | Fresh per-workstream sessions, terse starter prompts, `/compact` at AC boundaries. |

## Context preservation practices

- **One workstream per session**. Fresh context per worktree.
- **Starter prompt is terse.** Only AC rows + workstream paragraph, not the whole project.
- **Explore subagent for broad searches.** Keeps research out of main context.
- **Commit per AC.** State lives in git. The session reloads git when it needs it.
- **Interim notes to `docs/workstream-notes/<ws-id>-progress.md`.** Designated scratch.
- **`/compact` at AC boundaries.** Explicit cleanup.
- **`maxTurns: 80`.** Hard cap on runaways.

## Morning triage flow

1. Run the digest:
   ```bash
   ~/.claude/bin/daily-digest.sh
   ```
   Opens a report at `~/.claude/cc-optimizer/digests/YYYY-MM-DD.md` in VSCode.
2. For each workstream:
   - Read its section of the digest (commits, files touched, AC claims, typecheck/lint status).
   - Open the draft PR (link in digest).
   - Read CodeRabbit comments. Address any the session missed.
   - Check CI status.
   - If clean: `gh pr ready <num>` (session may have already done this), review the diff yourself, merge.
3. After merging a workstream, clean up its worktree:
   ```bash
   git worktree remove ../online-chat-server-worktrees/<ws-id-lower>
   ```
4. If any workstream flagged blocked: open `docs/workstream-notes/<ws-id>-blockers.md`, resolve the question, decide whether to restart or hand-finish.
5. Kick off the next phase (if not already cascaded).

## Troubleshooting

### Session stuck / hung
- Check spawn log: `tail ~/.claude/cc-optimizer/spawn-log.jsonl`. Find the PID.
- Check Stop hook notification — did the session stop cleanly?
- Kill: `kill <pid>`. Or kill all autorun sessions at once: see kill switch below.

### Session hit `maxTurns`
- The Stop hook fires with `Task finished` notification. In the digest, "maxTurns hit" flag appears.
- Either restart the session (`cd <worktree> && claude < /tmp/cc-starter-<ws-id>.md`) to continue, or take over manually.

### Cascade coordinator misbehaving
- Kill switch: `touch ~/.claude/cc-optimizer/cascade-disabled`. Coordinator exits immediately on next run.
- Full unload: `launchctl unload ~/Library/LaunchAgents/com.elisey.cascade-coordinator.plist`.
- Inspect log: `tail -50 ~/.claude/cc-optimizer/cascade.log`.
- To re-enable after fixing: `rm ~/.claude/cc-optimizer/cascade-disabled` (and re-load if you unloaded).

### Kill everything (last-resort panic button)
```bash
# Stop cascade
touch ~/.claude/cc-optimizer/cascade-disabled
launchctl unload ~/Library/LaunchAgents/com.elisey.cascade-coordinator.plist

# Kill all autorun CC sessions
pkill -f "claude.*cc-starter" || true
rm -f /tmp/cc-starter-*.md
```
This leaves worktrees in place for you to review. Remove them manually after.

### Worktree has uncommitted changes when you try to remove
```bash
git worktree remove --force <path>
```

### PR didn't auto-merge even though it looks ready
- Check the cascade criteria in `~/.claude/bin/cascade-coordinator.sh` §7.1.
- Common misses: PR still draft (session didn't un-draft), no `<!-- autorun: ready-for-merge -->` comment, CI check not SUCCESS (maybe SKIPPED is fine, check logic), last commit too recent (wait for 15-min idle threshold).
- Inspect `cascade.log`: look for the PR number and the skip reason.

## Cascade coordinator overview (see `~/.claude/bin/cascade-coordinator.sh` for implementation)

- Runs every hour between 22:00 and 08:00 via launchd plist `com.elisey.cascade-coordinator`.
- For each PR labeled `autorun`, evaluates ALL criteria:
  - CI all-green
  - Not draft
  - CodeRabbit not CHANGES_REQUESTED
  - Has `<!-- autorun: ready-for-merge -->` comment
  - Last commit ≥ 15 minutes old
  - No `blocked`/`needs-human-review`/`cascade-hold` label
- If all pass: `gh pr merge --squash --delete-branch`, then spawn newly-unblocked dependents.
- Max 4 auto-merges per hour.
- All decisions logged to `~/.claude/cc-optimizer/cascade.log`.

## settings.local.json template

If lost, recreate from `.claude/settings.local.json` in the dotfiles repo or per §1 of the plan at `~/.claude/plans/`. Key fields:

```json
{
  "permissionMode": "bypassPermissions",
  "maxTurns": 80,
  "permissions": {
    "allow": ["Edit", "Write", "MultiEdit"],
    "deny": ["Bash(rm -rf *)", "Bash(git push origin develop*)", "Bash(sudo *)", "...many more..."],
    "additionalDirectories": ["/tmp", "/Users/elisey/Downloads/online-chat-server", "/Users/elisey/Downloads/online-chat-server-worktrees"]
  }
}
```

This file is **gitignored** so each machine manages its own copy.
