# ADR-010: TypeBox as the Single Schema Source of Truth

- **Status**: Accepted
- **Date**: 2026-04-18

## Context

The system's API contracts (REST request/response bodies, WebSocket command/event envelopes, and shared constants) must be:

1. **Validated at runtime** on both the server (for incoming requests) and, optionally, the client (for untrusted payloads).
2. **Typed at compile time** in TypeScript on both sides, with types derived from the same artefact used for runtime validation.
3. **Documented as OpenAPI** so that human reviewers and tooling can inspect the contract without reading code.
4. **Enforced identically** in every place the same shape is used — there is ONE shape definition, not two that happen to agree.

This is the single most important anti-drift mechanism in the project. Without it, AI-generated code invents slightly different payload shapes per endpoint, per session, per reviewer. With it, a schema mismatch is a compile error, not a runtime surprise in production.

Two viable schema libraries exist in the TypeScript ecosystem:

- **Zod**: runtime validator with Zod-native types; converts to/from JSON Schema via `zod-to-json-schema` in Zod 4.
- **TypeBox**: produces **native JSON Schema** objects that infer TypeScript types via `Static<typeof X>`.

Fastify's type provider system (`@fastify/type-provider-typebox`) is built around JSON Schema and has first-class TypeBox integration. `@fastify/swagger` serialises route schemas (JSON Schema) directly to OpenAPI. Using Zod adds an intermediate conversion step where schemas are Zod objects → JSON Schema → OpenAPI, introducing an avoidable seam and a class of conversion bugs.

## Decision

Use **TypeBox** as the single schema source of truth for all API contracts.

### Rules

1. **Every request and response body** of every Fastify route MUST have a TypeBox schema defined in `packages/shared-schemas/src/` and referenced via Fastify's `{ schema: { body, querystring, response } }` config.
2. **Every WebSocket command and event payload** MUST have a TypeBox schema in the same package. Validation is applied on inbound commands and on outbound events (dev mode only, for catching regressions).
3. **TypeScript types** used on either side of the wire MUST be derived via `Static<typeof Schema>`. No hand-written TypeScript interface is allowed to describe a wire shape.
4. **OpenAPI** is generated from route schemas via `@fastify/swagger`. No hand-maintained OpenAPI file is kept. The generated document is committed as a CI artefact for review but is not the source.
5. **Frontend code** imports ONLY the derived TypeScript types (via `import type`) from `packages/shared-schemas`. It MUST NOT import the TypeBox schemas themselves (no runtime validation code shipped to the browser from shared package). Rationale: keeps the browser bundle small and prevents accidental frontend coupling to server-side validation internals.
6. **Constants** (enum values, error codes, size limits) live in `packages/shared-schemas/src/constants/` and are imported by both sides.

### Naming and organisation

```
packages/shared-schemas/src/
  schemas/
    auth.ts         // AuthRegisterRequest, AuthRegisterResponse, LoginRequest, ...
    rooms.ts
    messages.ts
    read-state.ts
    events.ts       // WebSocket event payloads, one Type per event type
    envelopes.ts    // ErrorEnvelope, PaginationEnvelope, EventEnvelope
  constants/
    error-codes.ts  // typed union of every error code in api-and-events.md §4.5
    limits.ts       // MESSAGE_MAX_BYTES = 3 * 1024, ...
  index.ts          // re-exports schemas and types
```

Every schema name ends in `Request`, `Response`, `Payload`, or `Envelope`. No generic names.

### Form validation

Frontend forms do not use TypeBox for runtime validation. Instead:

- Input component-level validation uses plain TypeScript functions.
- Submission relies on the server response: a rejected `VALIDATION_ERROR` contains `error.details.fieldErrors` from Fastify's validator, which the form renders inline.

Rationale: browser-side validation is a convenience, not a security boundary. The server schema is the authority. Avoid duplicating validation logic on both sides.

## Consequences

### Positive

- **One shape, one truth.** The same TypeBox object drives Fastify runtime validation, TypeScript types on both client and server, and the published OpenAPI spec.
- **Zero conversion seam.** TypeBox → JSON Schema is identity; JSON Schema → OpenAPI is identity.
- **Drift is a compile error.** A backend handler returning a shape that doesn't match its response schema fails TypeScript check; a frontend consumer using a renamed field fails TypeScript check.
- **AI-friendly.** Claude Code sessions must look up the schema to add a field. The schema file is the one place to edit.

### Negative

- TypeBox syntax is more verbose than Zod for complex refinements (regex, cross-field validators). Custom assertions for those cases live alongside the schema as named functions.
- TypeBox has a smaller community than Zod. Mitigated by the Fastify-native ergonomics and the small schema surface of this project.
- Contributors may reach for Zod reflexively. The ESLint config forbids `import ... from 'zod'` to prevent accidental introduction.

## Enforcement

- `eslint.config.js` → `no-restricted-imports` bans `zod`, `yup`, `joi`, `ajv` (direct usage).
- CI job `doc-consistency.yml` (see `docs/ci-pipeline.md`) verifies every route file has a schema property configured.
- `docs/ai-development-guardrails.md` mandates: "any new endpoint requires a new or reused TypeBox schema in `packages/shared-schemas`" as a PR checklist item.

## Review triggers

- Fastify deprecates TypeBox type provider in favour of another.
- TypeBox stops maintaining compatibility with the active JSON Schema draft Fastify uses.
- The project grows to need refinement features TypeBox genuinely cannot express and Zod can.
