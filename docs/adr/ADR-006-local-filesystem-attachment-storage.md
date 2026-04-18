# ADR-006: Store Attachment Binaries on Local Filesystem

- **Status**: Accepted
- **Date**: 2026-04-18

## Context

The requirements explicitly state that files shall be stored on the local file system and the runtime must be self-contained locally.

## Decision

Store attachment binaries on a mounted local filesystem volume. Store attachment metadata and authorization linkage in PostgreSQL.

## Consequences

### Positive
- matches runtime constraint directly
- simple local deployment
- easy volume persistence across restarts

### Negative
- local filesystem paths require careful cleanup and path sanitization
- not horizontally scalable without later redesign
