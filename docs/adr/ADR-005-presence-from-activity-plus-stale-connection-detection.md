# ADR-005: Derive Presence from Activity Plus Stale-Connection Detection

- **Status**: Accepted
- **Date**: 2026-04-18

## Context

Presence must support multi-tab behavior and AFK after more than one minute of inactivity. Browsers may hibernate tabs and stop JavaScript execution, so explicit inactive or close signals are not reliable.

## Decision

Derive presence from:
- recent user-activity signals from any live tab
- server-side stale detection using websocket heartbeat/liveness

## Consequences

### Positive
- robust against tab hibernation
- matches multi-tab requirements
- avoids heavy DB polling

### Negative
- requires heartbeat design and stale thresholds
- transient false offline/AFK windows are possible during reconnects
