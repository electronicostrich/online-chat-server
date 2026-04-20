import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev / E2E the React app talks to the Fastify API via the Vite dev
// server's proxy. That keeps the SPA same-origin so the session cookie and
// CSRF double-submit "just work" without the API needing CORS configured.
// The proxy target reads `VITE_API_PROXY_TARGET`. The default points at
// `http://api:3000` which matches the in-network hostname when the web
// service runs inside the compose stack (`compose.yaml`'s `chat-net`
// network resolves `api` to the API container). For developers running
// `pnpm --filter web dev` outside compose, set the env var to
// `http://localhost:3000`.
const API_PROXY_TARGET: string =
  process.env.VITE_API_PROXY_TARGET ?? 'http://api:3000';

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

const proxy: Record<string, { target: string; changeOrigin: boolean; ws?: boolean }> = {};
for (const path of API_PATHS) {
  proxy[path] = { target: API_PROXY_TARGET, changeOrigin: true };
}
proxy['/ws'] = { target: API_PROXY_TARGET, changeOrigin: true, ws: true };

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy,
  },
});
