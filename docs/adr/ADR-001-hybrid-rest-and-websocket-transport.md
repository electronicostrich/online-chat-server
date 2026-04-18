# ADR-001: Use Hybrid REST and WebSocket Transport

- **Status**: Accepted
- **Date**: 2026-04-18

## Context

The system must support low-latency message delivery and presence updates, but must also remain easy to recover, reload, and operate locally. REST-only polling is not appropriate for moderate-scale message updates. WebSocket-only data loading complicates initial page load, recovery, and authoritative state sync.

## Decision

Use:
- REST for authoritative reads and mutations
- WebSocket for low-latency event propagation

## Consequences

### Positive
- simpler initial page load
- robust reconnect and gap recovery
- lower polling load
- clearer debugging and retry behavior

### Negative
- two transport styles to maintain
- requires careful consistency rules between REST and WebSocket
