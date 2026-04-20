import type {
  AuthSessionResponse,
  LogoutSessionRequest,
  LoginRequest,
  SessionsListResponse,
} from 'shared-schemas';
import { apiRequest } from './client.js';

type AuthSessionData = AuthSessionResponse['data'];
type SessionsListData = SessionsListResponse['data'];

export type AuthSessionUser = AuthSessionData['user'];
export type SessionSummary = SessionsListData['sessions'][number];

export async function login(input: LoginRequest): Promise<AuthSessionData> {
  return apiRequest<AuthSessionData>('/auth/login', {
    method: 'POST',
    body: input,
  });
}

export async function logout(): Promise<void> {
  await apiRequest<{ ok: true }>('/auth/logout', { method: 'POST' });
}

// Used at boot to detect whether the user already has a session (the cookie is
// httpOnly so the SPA can't read it directly). On 401 we know the user is
// signed out and should land on the login screen.
export async function fetchCurrentSession(): Promise<SessionSummary | null> {
  const data = await apiRequest<SessionsListData>('/sessions');
  return data.sessions.find((session) => session.current) ?? null;
}

export async function listSessions(): Promise<SessionSummary[]> {
  const data = await apiRequest<SessionsListData>('/sessions');
  return data.sessions;
}

export async function revokeSession(sessionId: string): Promise<void> {
  const body: LogoutSessionRequest = { sessionId };
  await apiRequest<{ ok: true }>('/auth/logout-session', {
    method: 'POST',
    body,
  });
}
