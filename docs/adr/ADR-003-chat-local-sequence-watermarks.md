# ADR-003: Use Chat-Local Sequence Numbers for Message Integrity

- **Status**: Accepted
- **Date**: 2026-04-18

## Context

Timestamps are insufficient for detecting missing or out-of-order messages. Organizer guidance explicitly called for chat watermarks / incremental IDs to verify message-history integrity and detect gaps.

## Decision

Assign each persisted message the next monotonically increasing sequence number within its chat. Clients track highest contiguous sequence and requery authoritative history when gaps are detected.

## Consequences

### Positive
- deterministic ordering
- reliable gap detection
- robust reconnect repair
- simpler unread model

### Negative
- requires transaction-safe sequence allocation
- requires sequence-aware APIs and client merge logic
