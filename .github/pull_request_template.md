<!--
Template enforced by scripts/check-pr-description.ts (see docs/script-specs.md §6).
Required sections: Summary, AC IDs addressed, Docs updated, Testing.
Do not remove section headers — CI parses them.
See docs/git-workflow.md §7.1 for the full contract.
-->

## Summary

<!-- One paragraph. WHY, not WHAT. The diff tells the what. -->

## AC IDs addressed

<!--
List each AC ID touched with a brief note. Use links to docs/traceability.md rows.
If the PR is CHORE: / DOC: / INFRA: / SPIKE: with no AC, write "None — see title tag"
and explain the scope in Summary.
-->

- [ ] AC-XXX-XX — *short note*

## Docs updated

<!--
Tick every doc file touched. If none, write "No doc changes because <reason>".
-->

- [ ] `docs/product-requirements.md`
- [ ] `docs/requirements-decisions.md`
- [ ] `docs/architecture-overview.md`
- [ ] `docs/state-model.md`
- [ ] `docs/data-model.md`
- [ ] `docs/api-and-events.md`
- [ ] `docs/permissions-matrix.md`
- [ ] `docs/acceptance-criteria-pack.md`
- [ ] `docs/edge-cases-and-business-rules.md`
- [ ] `docs/ux-flow-notes.md`
- [ ] `docs/glossary.md`
- [ ] `docs/registers.md`
- [ ] `docs/traceability.md`
- [ ] `docs/adr/` (ADR-###)
- [ ] `docs/repo-layout.md`
- [ ] `docs/runtime-and-environment.md`
- [ ] `docs/error-envelope-and-conventions.md`
- [ ] `docs/testing-strategy.md`
- [ ] `docs/ai-development-guardrails.md`
- [ ] `docs/ci-pipeline.md`
- [ ] `docs/git-workflow.md`
- [ ] `docs/hooks.md`
- [ ] `docs/stage-0-bootstrap.md`
- [ ] `docs/script-specs.md`
- [ ] `CLAUDE.md`
- [ ] No doc changes because *__________*

## Testing

<!--
One line per AC confirming Playwright passes locally.
Plus one line for unit/integration coverage on new code.
-->

- [ ] AC-XXX-XX: Playwright test `AC-XXX-XX-slug.spec.ts` passes locally
- [ ] Unit/integration tests added/updated for all new logic
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm doc-consistency` all green locally

## Screenshots or recordings

<!-- For UI-visible changes. Skip for backend-only. -->

## Destructive-migration disclosure

<!--
Leave empty UNLESS the PR contains any of: DROP TABLE, DROP COLUMN, TRUNCATE,
NOT NULL on an existing column, or any other destructive SQL.
If disclosed: describe the data-preservation plan and confirm PO has signed off.
See docs/ai-development-guardrails.md §5.5.
-->

## Dependencies added

<!--
Leave empty UNLESS package.json or pnpm-lock.yaml changed.
If disclosed: list each new dep, why, and which existing libraries it overlaps with.
See docs/ai-development-guardrails.md §5.3.
-->
