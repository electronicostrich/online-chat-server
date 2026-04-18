# ADR-004: Use Server-Managed Revocable Sessions

- **Status**: Accepted
- **Date**: 2026-04-18

## Context

The product requires active-session listing, browser/IP details, selective session revocation, and logout of only the current browser session. Immediate revocation behavior is important.

## Decision

Use server-managed sessions backed by persisted session records. Authenticate browser requests using secure session cookies. Avoid JWT-only long-lived auth as the primary model.

## Consequences

### Positive
- supports active-session UI cleanly
- immediate revocation is straightforward
- easier to reason about current-session logout

### Negative
- requires server-side session storage and lookup
- requires CSRF protections for cookie-based state-changing requests
