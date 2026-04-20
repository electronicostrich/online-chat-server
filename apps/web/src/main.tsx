import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.js';
import { SessionProvider } from './auth/SessionContext.js';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      // The chat history view is its own source of truth post-mount because
      // the websocket pushes deltas — refetching on focus would re-pull the
      // entire window unnecessarily.
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
