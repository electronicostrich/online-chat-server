# ADR-007: Use a Modular Monolith as the Default Service Shape

- **Status**: Accepted
- **Date**: 2026-04-18

## Context

The target scale is moderate, the runtime must be locally operable, and the system has many tightly coupled state transitions. Early microservice decomposition would add coordination and failure modes.

## Decision

Implement the backend as one deployable service with internal modules for auth, sessions, presence, relationships, rooms, messaging, attachments, notifications, and realtime fan-out.

## Consequences

### Positive
- simpler local deployment
- easier debugging
- fewer distributed consistency problems
- faster iteration on coupled state logic

### Negative
- less independent scaling flexibility
- later extraction of modules requires refactoring
