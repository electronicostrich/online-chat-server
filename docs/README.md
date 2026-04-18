# Online Chat Server Documentation Pack

## Contents

Read in this order:

1. `product-requirements.md`
2. `requirements-decisions.md`
3. `architecture-overview.md`
4. `state-model.md`
5. `data-model.md`
6. `api-and-events.md`
7. `permissions-matrix.md`
8. `acceptance-criteria-pack.md`
9. `edge-cases-and-business-rules.md`
10. `ux-flow-notes.md`
11. `glossary.md`
12. `registers.md`
13. `adr/`

## Purpose

This pack turns the PRD into an implementation-ready technical and BA baseline for a production-adjacent chat system that runs locally via Docker Compose.

## Document map

- **product-requirements.md**  
  Source-backed product scope, functional requirements, non-functional requirements, realtime constraints, and chosen default product decisions.

- **requirements-decisions.md**  
  Finalized requirement-level decisions that were previously open or fuzzy, including normalization, session transport, unread semantics, DM lifecycle, and attachment policy.

- **architecture-overview.md**  
  System shape, runtime topology, component responsibilities, synchronization model, security model, and recovery behavior.

- **state-model.md**  
  Explicit state machines and transitions for sessions, presence, friendship, blocks, rooms, invitations, bans, messages, attachments, and unread state.

- **data-model.md**  
  Persistent entities, fields, constraints, indexes, and lifecycle notes.

- **api-and-events.md**  
  REST contract, WebSocket contract, payload shapes, ordering and idempotency rules, reconnect and gap-repair protocol.

- **permissions-matrix.md**  
  Role/action matrix covering account, sessions, rooms, DMs, moderation, attachments, unread state, and information visibility.

- **acceptance-criteria-pack.md**  
  Capability-level acceptance criteria for auth, presence, rooms, invitations, moderation, messaging, realtime sync, attachments, unread state, and UI behavior.

- **edge-cases-and-business-rules.md**  
  Expected outcomes for high-risk transition scenarios and frozen business rules for QA and development.

- **ux-flow-notes.md**  
  Behavioral notes for ambiguous screens and interaction flows.

- **glossary.md**  
  Canonical vocabulary and term definitions.

- **registers.md**  
  Risk register, assumption register, decision register, and open issues register.

- **adr/**  
  Architecture Decision Records for major technical choices.

## Source alignment

This pack is aligned to:
- the formal requirements document
- the kickoff transcript and organizer clarifications
- the finalized PRD decisions already made for this project

Where a behavior was not fully specified by source material, the documents mark it as a **chosen default**, **recommended default**, or **owner-controlled default** rather than treating it as a source requirement.
