import type { APIRequestContext, APIResponse } from '@playwright/test';

export interface LoginOptions {
  email: string;
  password: string;
}

export interface AuthedSession {
  userId: string;
  sessionId: string;
  csrfToken: string;
  // HTTP response from the login/register call — kept around so tests that
  // need to inspect Set-Cookie or additional metadata can.
  response: APIResponse;
}

// Historical alias: older specs used LoggedInSession. Keep it exported so
// a future rename can happen without thrashing every spec at once.
export type LoggedInSession = AuthedSession;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function parseCookieValue(setCookie: string, name: string): string | undefined {
  const pattern = new RegExp(`(?:^|;\\s*)${escapeRegExp(name)}=([^;]+)`, 'u');
  for (const chunk of setCookie.split(/\n|,(?=[^ ])/u)) {
    const m = pattern.exec(chunk);
    if (m?.[1] !== undefined) return m[1];
  }
  return undefined;
}

interface AuthResponseBody {
  data: {
    user: { id: string };
    session: { id: string };
  };
}

interface RegisterPayload {
  email: string;
  username: string;
  password: string;
}

async function authCall(
  api: APIRequestContext,
  path: '/auth/login' | '/auth/register',
  body: LoginOptions | RegisterPayload,
  label: string,
): Promise<AuthedSession> {
  const res = await api.post(path, { data: body });
  if (res.status() !== 200) {
    throw new Error(`${label} failed: status=${res.status().toString()}`);
  }
  const setCookie = res.headers()['set-cookie'] ?? '';
  const csrfToken = parseCookieValue(setCookie, 'csrf_token');
  if (csrfToken === undefined) {
    throw new Error(`${label} succeeded but no csrf_token cookie was set`);
  }
  const parsed = (await res.json()) as AuthResponseBody;
  return {
    userId: parsed.data.user.id,
    sessionId: parsed.data.session.id,
    csrfToken,
    response: res,
  };
}

export function login(
  api: APIRequestContext,
  opts: LoginOptions,
): Promise<AuthedSession> {
  return authCall(api, '/auth/login', opts, 'login');
}

export function register(
  api: APIRequestContext,
  input: { email: string; username: string; password: string },
): Promise<AuthedSession> {
  return authCall(api, '/auth/register', input, 'register');
}

export function csrfHeaders(
  session: Pick<AuthedSession, 'csrfToken'>,
): Record<string, string> {
  return { 'X-CSRF-Token': session.csrfToken };
}
