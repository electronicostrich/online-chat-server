import type { ReactElement } from 'react';
import { useSession } from './auth/SessionContext.js';
import { AppShell } from './components/AppShell.js';
import { LoginForm } from './components/LoginForm.js';

export function App(): ReactElement {
  const { status, bootError } = useSession();

  if (status === 'loading') {
    return (
      <main className="login-screen" data-testid="boot-loading">
        <p>Loading…</p>
      </main>
    );
  }
  if (status === 'boot-error') {
    return (
      <main className="login-screen" data-testid="boot-error">
        <div className="login-form">
          <h1>Connection problem</h1>
          <p role="alert">
            Could not reach the chat server. Please check your connection and
            reload.
          </p>
          {bootError !== undefined ? (
            <p className="login-error" data-testid="boot-error-detail">
              {bootError}
            </p>
          ) : null}
        </div>
      </main>
    );
  }
  if (status === 'signed-out') {
    return <LoginForm />;
  }
  return <AppShell />;
}
