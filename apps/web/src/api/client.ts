// Typed wrapper around `fetch` for the React SPA. Centralises:
// - the API base URL (from `VITE_API_BASE_URL`),
// - cookie-based session auth (`credentials: 'include'`),
// - the double-submit CSRF header sourced from the `csrf_token` cookie,
// - shared-schema success-envelope unwrap into a typed value,
// - shared-schema error-envelope to a typed `ApiError`.

// Empty string = same-origin requests against the Vite dev server, which
// proxies API paths to the Fastify backend. See `vite.config.ts`. Override
// via `VITE_API_BASE_URL` for builds where the SPA is served separately
// from the API (production deploys are not in MVP scope yet).
const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

interface SuccessEnvelopeShape<T> {
  data: T;
}

interface ErrorEnvelopeShape {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    traceId?: string;
  };
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: Record<string, unknown> | null;

  public constructor(status: number, body: ErrorEnvelopeShape) {
    super(body.error.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error.code;
    this.details = body.error.details ?? null;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

function readCsrfTokenCookie(): string | null {
  const raw = document.cookie;
  if (raw.length === 0) return null;
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith('csrf_token=')) {
      return decodeURIComponent(trimmed.slice('csrf_token='.length));
    }
  }
  return null;
}

function buildHeaders(hasBody: boolean): HeadersInit {
  const headers: Record<string, string> = {};
  if (hasBody) headers['Content-Type'] = 'application/json';
  // CSRF: API requires X-CSRF-Token on state-changing methods when a session
  // cookie is present. Sending it on GET is harmless.
  const csrf = readCsrfTokenCookie();
  if (csrf !== null) headers['X-CSRF-Token'] = csrf;
  return headers;
}

export async function apiRequest<TData>(
  path: string,
  options: RequestOptions = {},
): Promise<TData> {
  const method = options.method ?? 'GET';
  const hasBody = options.body !== undefined;
  const init: RequestInit = {
    method,
    credentials: 'include',
    headers: buildHeaders(hasBody),
  };
  if (hasBody) init.body = JSON.stringify(options.body);
  if (options.signal !== undefined) init.signal = options.signal;

  const response = await fetch(`${API_BASE_URL}${path}`, init);
  const text = await response.text();
  // Every documented endpoint returns a JSON envelope on both success and
  // error paths. A non-JSON body (e.g. an upstream proxy 5xx HTML page) is
  // normalised to `ApiError` so callers never see a raw `SyntaxError` from
  // `JSON.parse`.
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (err) {
      throw new ApiError(response.status, {
        error: {
          code: 'UNKNOWN',
          message: `Response was not valid JSON (${
            err instanceof Error ? err.message : 'parse error'
          })`,
        },
      });
    }
  }

  if (!response.ok) {
    if (isErrorEnvelope(parsed)) {
      throw new ApiError(response.status, parsed);
    }
    throw new ApiError(response.status, {
      error: {
        code: 'UNKNOWN',
        message: `Request failed with status ${response.status.toString()}`,
      },
    });
  }
  if (!isSuccessEnvelope<TData>(parsed)) {
    throw new ApiError(response.status, {
      error: {
        code: 'UNKNOWN',
        message: 'Response did not match the success-envelope shape',
      },
    });
  }
  return parsed.data;
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelopeShape {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { error?: unknown };
  if (typeof candidate.error !== 'object' || candidate.error === null) return false;
  const err = candidate.error as { code?: unknown; message?: unknown };
  return typeof err.code === 'string' && typeof err.message === 'string';
}

function isSuccessEnvelope<T>(value: unknown): value is SuccessEnvelopeShape<T> {
  if (typeof value !== 'object' || value === null) return false;
  return 'data' in value;
}

export const apiBaseUrl = API_BASE_URL;
