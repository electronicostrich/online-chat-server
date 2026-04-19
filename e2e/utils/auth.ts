import type { APIRequestContext, APIResponse } from '@playwright/test';

export interface LoginOptions {
  email: string;
  password: string;
}

export interface LoggedInSession {
  userId: string;
  sessionId: string;
  csrfToken: string;
  loginResponse: APIResponse;
}

function parseCookieValue(setCookie: string, name: string): string | undefined {
  for (const chunk of setCookie.split(/\n|,(?=[^ ])/u)) {
    const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`, 'u').exec(chunk);
    if (m?.[1] !== undefined) return m[1];
  }
  return undefined;
}

interface LoginResponseBody {
  data: {
    user: { id: string };
    session: { id: string };
  };
}

export async function login(
  api: APIRequestContext,
  opts: LoginOptions,
): Promise<LoggedInSession> {
  const res = await api.post('/auth/login', { data: opts });
  if (res.status() !== 200) {
    throw new Error(`login failed: status=${res.status().toString()}`);
  }
  const setCookie = res.headers()['set-cookie'] ?? '';
  const csrfToken = parseCookieValue(setCookie, 'csrf_token');
  if (csrfToken === undefined) {
    throw new Error('login succeeded but no csrf_token cookie was set');
  }
  const body = (await res.json()) as LoginResponseBody;
  return {
    userId: body.data.user.id,
    sessionId: body.data.session.id,
    csrfToken,
    loginResponse: res,
  };
}

export async function register(
  api: APIRequestContext,
  input: { email: string; username: string; password: string },
): Promise<LoggedInSession> {
  const res = await api.post('/auth/register', { data: input });
  if (res.status() !== 200) {
    throw new Error(`register failed: status=${res.status().toString()}`);
  }
  const setCookie = res.headers()['set-cookie'] ?? '';
  const csrfToken = parseCookieValue(setCookie, 'csrf_token');
  if (csrfToken === undefined) {
    throw new Error('register succeeded but no csrf_token cookie was set');
  }
  const body = (await res.json()) as LoginResponseBody;
  return {
    userId: body.data.user.id,
    sessionId: body.data.session.id,
    csrfToken,
    loginResponse: res,
  };
}

export function csrfHeaders(
  session: Pick<LoggedInSession, 'csrfToken'>,
): Record<string, string> {
  return { 'X-CSRF-Token': session.csrfToken };
}
