import type {
  AuthSessionResponse,
  LoginRequest,
  SessionsListResponse,
} from 'shared-schemas';
import { apiRequest } from './client.js';

type AuthSessionData = AuthSessionResponse['data'];
type SessionsListData = SessionsListResponse['data'];

export type AuthSessionUser = AuthSessionData['user'];

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
export async function fetchCurrentSession(): Promise<SessionsListData['sessions'][number] | null> {
  const data = await apiRequest<SessionsListData>('/sessions');
  return data.sessions.find((session) => session.current) ?? null;
}
