# WS-02 autorun progress — 2026-04-19

Branch: `feature/WS-02-autorun-20260419`

## Plan

Stage-0 repo. WS-02 owns identity/session/security. ACs in scope:
- AC-AUTH-01 registration (this PR's foundation; adds users, sessions, password hashing, session cookie, CSRF token cookie, auth module wiring)
- AC-AUTH-02 duplicate-registration rejects
- AC-AUTH-03 login creates one session
- AC-AUTH-04 logout revokes current only
- AC-AUTH-05 sessions listing
- AC-AUTH-06 revoke another session (HTTP path only; WS drop is WS-05's concern)
- AC-AUTH-07 password change
- AC-AUTH-08 password reset (SMTP transport deferred; raw token exposed via `NODE_ENV=test` inspector)
- AC-AUTH-09 **deferred** — account deletion cascade depends on WS-03-owned entities
- AC-PRES-05 no inactivity logout

## Conventions chosen

- Session cookie: `chat_sid` (httpOnly, SameSite=Lax, `Secure` in production). Value = opaque random 32-byte hex token; `session_token_hash` stores SHA-256 of that token.
- CSRF: double-submit cookie. `csrf_token` cookie (non-httpOnly, SameSite=Lax) set alongside session cookie. State-changing requests (POST/PUT/PATCH/DELETE) must send `X-CSRF-Token` header equal to the cookie value. Exempt: `/auth/register`, `/auth/login`, `/auth/password-reset/request`, `/auth/password-reset/confirm` (no existing session to check against).
- Password hashing: `@node-rs/argon2` (argon2id, prebuilt binaries, no compiler needed). Parameters driven by `PASSWORD_ARGON2_*` env.
- Username normalization per data-model.md §4.1: trim + NFC + whitespace-collapse, case-insensitive uniqueness.
- Session TTL: 30d default (`SESSION_TTL_SECONDS` env).

## Non-scope for this run

- WebSocket auth and revocation propagation → WS-05.
- Frontend auth UI → WS-07 (this autorun may ship a minimal form only if time allows; otherwise API-only smoke tests).
- Role/permission helper package → deferred; ACs in scope don't need room permissions yet.
