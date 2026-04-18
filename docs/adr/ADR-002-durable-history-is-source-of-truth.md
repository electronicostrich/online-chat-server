# ADR-002: Durable History Is the Source of Truth

- **Status**: Accepted
- **Date**: 2026-04-18

## Context

Users may disappear for long periods. Transient delivery queues cannot grow forever. WebSocket streams can be interrupted, delayed, or incomplete.

## Decision

Persist all durable chat history in PostgreSQL and treat it as the source of truth. Realtime delivery is an acceleration layer only. Missing or late events are repaired from history APIs.

## Consequences

### Positive
- no unbounded offline queue requirement
- reconnects are deterministic
- history is queryable and durable

### Negative
- requires explicit repair logic
- increases importance of efficient history pagination and indexing
