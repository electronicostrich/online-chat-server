import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client.js';
import {
  listSessions,
  revokeSession,
  type SessionSummary,
} from '../api/auth.js';

interface SessionsScreenProps {
  onBack: () => void;
}

// AC-AUTH-05 — Active sessions screen. Lists every active session the caller
// owns with the same fields the REST contract returns: user-agent, IP, created
// and last-seen timestamps, and whether it's the current session.
// AC-AUTH-06 — Revoking another session is immediate: the revoke button calls
// `/auth/logout-session`, invalidates the cached list, and the backend tears
// down the target session's websocket and session cookie.
export function SessionsScreen({ onBack }: SessionsScreenProps): ReactElement {
  const queryClient = useQueryClient();
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['sessions'],
    queryFn: listSessions,
  });

  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) => revokeSession(sessionId),
    onSuccess: async (_result, sessionId) => {
      setRevokeError(null);
      // Drop the revoked row optimistically so the UI reflects the change
      // before the refetch lands, then reconcile with the server.
      queryClient.setQueryData<SessionSummary[]>(['sessions'], (prev) =>
        prev === undefined ? prev : prev.filter((session) => session.id !== sessionId),
      );
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err: unknown) => {
      const message =
        err instanceof ApiError ? err.message : 'Revoke failed. Please try again.';
      setRevokeError(message);
    },
  });

  return (
    <section
      className="sessions-screen"
      data-testid="sessions-screen"
      aria-label="Active sessions"
    >
      <header className="sessions-screen-header">
        <h1>Active sessions</h1>
        <button
          type="button"
          data-testid="sessions-back"
          onClick={() => {
            onBack();
          }}
        >
          Back to chat
        </button>
      </header>
      {isLoading ? (
        <p data-testid="sessions-loading">Loading sessions…</p>
      ) : null}
      {isError ? (
        <div className="sessions-error" data-testid="sessions-error" role="alert">
          <p>
            {error instanceof ApiError
              ? error.message
              : 'Could not load sessions.'}
          </p>
          <button
            type="button"
            onClick={() => {
              void refetch();
            }}
          >
            Retry
          </button>
        </div>
      ) : null}
      {data !== undefined ? (
        <ul className="sessions-list" data-testid="sessions-list">
          {data.map((session) => (
            <li
              key={session.id}
              className="sessions-list-item"
              data-testid="sessions-list-item"
              data-session-id={session.id}
              data-current={session.current ? 'true' : 'false'}
            >
              <div className="sessions-list-meta">
                <span data-testid="session-user-agent">
                  {session.userAgent ?? 'Unknown device'}
                </span>
                <span data-testid="session-ip-address">
                  {session.ipAddress ?? 'Unknown IP'}
                </span>
                <span data-testid="session-created-at">
                  Signed in {formatTimestamp(session.createdAt)}
                </span>
                <span data-testid="session-last-seen-at">
                  Last seen {formatTimestamp(session.lastSeenAt)}
                </span>
              </div>
              <div className="sessions-list-actions">
                {session.current ? (
                  <span
                    className="sessions-current-badge"
                    data-testid="sessions-current-badge"
                  >
                    Current
                  </span>
                ) : (
                  <button
                    type="button"
                    data-testid="sessions-revoke"
                    disabled={revokeMutation.isPending}
                    onClick={() => {
                      setRevokeError(null);
                      revokeMutation.mutate(session.id);
                    }}
                  >
                    {revokeMutation.isPending &&
                    revokeMutation.variables === session.id
                      ? 'Revoking…'
                      : 'Revoke'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {revokeError !== null ? (
        <p
          role="alert"
          className="sessions-error"
          data-testid="sessions-revoke-error"
        >
          {revokeError}
        </p>
      ) : null}
    </section>
  );
}

function formatTimestamp(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString();
}
