import type { ErrorCode } from 'shared-schemas';

// Shared base for domain-level errors raised by WS-03+ modules. WS-02's
// AuthError pre-dates this and keeps its own class for backwards-compat;
// both shapes are handled identically by the Fastify error handler.
export class DomainError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    statusCode: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
