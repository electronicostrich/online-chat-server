import type { ReactElement } from 'react';
import { useSession } from './auth/SessionContext.js';
import { AppShell } from './components/AppShell.js';
import { LoginForm } from './components/LoginForm.js';

export function App(): ReactElement {
  const { status } = useSession();

  if (status === 'loading') {
    return (
      <main className="login-screen" data-testid="boot-loading">
        <p>Loading…</p>
      </main>
    );
  }
  if (status === 'signed-out') {
    return <LoginForm />;
  }
  return <AppShell />;
}
