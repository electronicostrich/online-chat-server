# Technical Registers
## Online Chat Server

## 1. Risk Register

| ID | Risk | Impact | Likelihood | Mitigation | Owner | Status |
|---|---|---:|---:|---|---|---|
| R-01 | Browser tab hibernation causes stale or wrong presence | High | High | Server-side stale timeout, heartbeat, reconnect reconciliation | TBD | Open |
| R-02 | Unbounded transient delivery backlog for inactive users | High | Medium | Persist durable history, bound socket buffers, recover by sequence repair | TBD | Open |
| R-03 | Missing or duplicate messages after reconnect | High | High | Per-chat sequence numbers, idempotent merge, range repair through REST | TBD | Open |
| R-04 | Lost file access control after room removal | High | Medium | Authorize downloads against current room membership every time | TBD | Open |
| R-05 | Room-name uniqueness inconsistently normalized across UI and DB | Medium | Medium | Define canonical normalization strategy and enforce in DB unique index | TBD | Open |
| R-06 | Session revocation does not close active websocket | High | Medium | Route sockets by session and emit `session.revoked` plus forced disconnect | TBD | Open |
| R-07 | Multi-tab unread state diverges | Medium | High | Server-authoritative read state, publish read updates to all tabs | TBD | Open |
| R-08 | Sequence allocation race under concurrent sends | High | Medium | Use transactional sequence increment and unique `(chat_id, sequence)` constraint | TBD | Open |
| R-09 | Attachment file exists without committed metadata or vice versa | Medium | Medium | Two-phase upload finalization and cleanup jobs | TBD | Open |
| R-10 | Private-room invitation accepted after room ban | Medium | Medium | Re-check room ban at accept time | TBD | Open |
| R-11 | Message delete hard-removal breaks reply continuity | Medium | Medium | Prefer logical delete in active chats | TBD | Open |
| R-12 | Redis outage causes perceived presence loss or fan-out disruption | Medium | Medium | Treat Redis as ephemeral only; rebuild from reconnects and durable state | TBD | Open |

## 2. Assumption Register

| ID | Assumption | Why Needed | Impact if False | Status |
|---|---|---|---|---|
| A-01 | Direct chat is created on first successful direct message | Product flow needed a single durable creation rule | Medium | Accepted |
| A-02 | Messages by deleted users remain in surviving rooms and render with deleted-account placeholder | Account-deletion attribution needed a deterministic default | Medium | Accepted |
| A-03 | Opening a chat advances read state only after successful sync and server acknowledgement | Need deterministic unread-clearing behavior | Low | Accepted |
| A-04 | Room visibility may be changed by owner after creation | Room settings need deterministic behavior | Medium | Accepted |
| A-05 | Password reset in local runtime uses a token flow with local mail sink or dev-visible delivery | Need local-runtime-compatible reset behavior | Low | Accepted |
| A-06 | Global room-name uniqueness is based on canonical trim + NFC + whitespace-collapse + case-insensitive comparison | Need deterministic DB constraint | Medium | Accepted |
| A-07 | Message deletions within active chats are implemented logically rather than physical row removal | Simplifies sequence continuity and reply references | Medium | Proposed |
| A-08 | Direct chat remains visible but read-only after user-to-user block or friendship removal | DM history retention needs deterministic behavior | Low | Accepted |

| A-09 | Username uniqueness uses the same canonical normalization strategy as room names | Avoid UI/DB mismatch in account creation | Medium | Accepted |
| A-10 | Core attachments have no file-type restriction beyond explicit size limits | Aligns with source requirement for arbitrary file types | Low | Accepted |

## 3. Decision Register

| ID | Decision | Rationale | Related ADR | Status |
|---|---|---|---|---|
| D-01 | Use hybrid REST + WebSocket transport | Balance simple authoritative reads with low-latency delivery | ADR-001 | Accepted |
| D-02 | Use durable history as source of truth | Avoid reliance on transient queues or websocket completeness | ADR-002 | Accepted |
| D-03 | Use chat-local sequence numbers | Detect gaps and repair state deterministically | ADR-003 | Accepted |
| D-04 | Use server-managed sessions | Needed for active-session listing and immediate revocation | ADR-004 | Accepted |
| D-05 | Derive presence from activity plus stale-connection logic | Handles multi-tab behavior and browser tab hibernation | ADR-005 | Accepted |
| D-06 | Store attachment binaries on local filesystem | Explicit product/runtime constraint | ADR-006 | Accepted |
| D-07 | Use modular monolith as default service shape | Simpler local deployment and lower coordination cost at target scale | ADR-007 | Accepted |
| D-08 | Use PostgreSQL + Redis | Separate durable business state from ephemeral coordination | ADR-008 | Accepted |

| D-09 | Use canonical trim + NFC + whitespace-collapse + case-insensitive name normalization | Prevent duplicate-looking usernames and rooms | requirements-decisions.md | Accepted |
| D-10 | Use cookie session auth with CSRF token plus origin checking | Needed for revocable sessions without CSRF ambiguity | requirements-decisions.md | Accepted |
| D-11 | Allow owner-driven room visibility changes after creation | Align room settings with deterministic behavior | requirements-decisions.md | Accepted |
| D-12 | Clear unread only after sync and server acknowledgement; propagate across tabs | Prevent false clears and tab divergence | requirements-decisions.md | Accepted |
| D-13 | Freeze existing DMs on friend removal and create DMs only on first successful message | Prevent DM lifecycle drift across backend/frontend | requirements-decisions.md | Accepted |
| D-14 | Preserve original filename in metadata, but store binaries under server-generated identifiers | Preserve UX while keeping storage safe | requirements-decisions.md | Accepted |

## 4. Open Issues Register

| ID | Issue | Options | Needed By | Owner | Status |
|---|---|---|---|---|---|
| O-03 | Edit/delete window policy for messages | unlimited / time-bounded / role-dependent | before message-edit implementation | TBD | Open |
| O-04 | Invitation expiry policy | no expiry / fixed expiry | before invitation cleanup implementation | TBD | Open |
| O-07 | Whether to support message send over REST only or also websocket command path | REST create / websocket create / both | before client transport implementation | TBD | Open |
| O-08 | Whether to retain message edit history | yes with audit table / no audit table | before moderation/audit implementation | TBD | Open |
| O-09 | Attachment virus scanning or content scanning in local runtime | none / optional extension | before attachment hardening work | TBD | Open |

## 5. Change control notes

- Accepted assumptions should be folded into product and technical documents as soon as they are frozen.
- Open issues should remain only when the implementation can safely proceed without a single committed product rule.
- Any issue that affects authorization, sequencing, or state transitions should be resolved before coding that area.
