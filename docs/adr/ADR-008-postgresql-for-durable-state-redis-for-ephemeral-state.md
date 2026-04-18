# ADR-008: Use PostgreSQL for Durable State and Redis for Ephemeral Coordination

- **Status**: Accepted
- **Date**: 2026-04-18

## Context

The system needs durable business state and history, plus fast ephemeral coordination for presence and socket fan-out. Using one store for both concerns would either overcomplicate durability or overburden the database.

## Decision

Use PostgreSQL for durable business state and Redis for ephemeral coordination state such as live socket routing, activity timestamps, and short-lived fan-out support.

## Consequences

### Positive
- clean separation of durable vs ephemeral concerns
- efficient presence and connection tracking
- Redis loss does not imply durable data loss

### Negative
- introduces another runtime dependency
- requires rebuild logic after Redis restart
