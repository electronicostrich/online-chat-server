import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// In dev / E2E the React app talks to the Fastify API via the Vite dev
// server's proxy. That keeps the SPA same-origin so the session cookie and
// CSRF double-submit "just work" without the API needing CORS configured.
// The proxy target reads `VITE_API_PROXY_TARGET` from `.env*` files via
// Vite's `loadEnv` helper. The default points at `http://api:3000` which
// matches the in-network hostname when the web service runs inside the
// compose stack (`compose.yaml`'s `chat-net` network resolves `api` to the
// API container). For developers running `pnpm --filter web dev` outside
// compose, set the env var to `http://localhost:3000`.

const API_PATHS = [
  '/auth',
  '/sessions',
  '/users',
  '/rooms',
  '/chats',
  '/dm',
  '/friends',
  '/blocks',
  '/messages',
  '/attachments',
  '/healthz',
  '/__test',
];

export default defineConfig(({ mode }) => {
  // Load all env vars (no `VITE_` filter) so the proxy can read either a
  // public `VITE_API_PROXY_TARGET` or a future build-time-only equivalent
  // without changing call sites.
  const env = loadEnv(mode, process.cwd(), '');
  const apiProxyTarget: string = env['VITE_API_PROXY_TARGET'] ?? 'http://api:3000';

  const proxy: Record<string, { target: string; changeOrigin: boolean; ws?: boolean; secure?: boolean }> = {};
  for (const path of API_PATHS) {
    proxy[path] = { target: apiProxyTarget, changeOrigin: true };
  }
  // Note: do NOT set `changeOrigin` on the WS proxy. http-proxy-3's WebSocket
  // path rewrites `Origin` when changeOrigin is true, which can collide with
  // some servers' Origin checks; the API doesn't validate Origin so leaving
  // it as-is is the safest default and lets the cookie travel unchanged.
  proxy['/ws'] = { target: apiProxyTarget, changeOrigin: false, ws: true, secure: false };

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy,
    },
  };
});
