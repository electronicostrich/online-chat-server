import type { SocketContext } from './types.js';

// In-process registry of live websocket connections. Production-grade
// realtime deployments fan out across nodes via Redis pub/sub — that's
// WS-01's job. For now the MVP runs on a single Fastify instance, so
// plain Sets are enough. When the Redis layer lands the fan-out call
// sites here become the only place that needs to change.
//
// `bySession` is keyed by session id and holds a Set of contexts
// because a single browser session can drive multiple live sockets
// (e.g. a tab that just refreshed and briefly overlaps with its old
// socket before it closes). Revocation MUST reach every socket bound
// to that session or a stale tab will keep receiving events after
// logout.
const sockets = new Set<SocketContext>();
const byUser = new Map<string, Set<SocketContext>>();
const bySession = new Map<string, Set<SocketContext>>();

function addTo(map: Map<string, Set<SocketContext>>, key: string, ctx: SocketContext): void {
  let set = map.get(key);
  if (set === undefined) {
    set = new Set();
    map.set(key, set);
  }
  set.add(ctx);
}

function removeFrom(
  map: Map<string, Set<SocketContext>>,
  key: string,
  ctx: SocketContext,
): void {
  const set = map.get(key);
  if (set === undefined) return;
  set.delete(ctx);
  if (set.size === 0) map.delete(key);
}

export function registerSocket(ctx: SocketContext): void {
  sockets.add(ctx);
  addTo(byUser, ctx.userId, ctx);
  addTo(bySession, ctx.sessionId, ctx);
}

export function unregisterSocket(ctx: SocketContext): void {
  sockets.delete(ctx);
  removeFrom(byUser, ctx.userId, ctx);
  removeFrom(bySession, ctx.sessionId, ctx);
}

export function socketsForUser(userId: string): SocketContext[] {
  const set = byUser.get(userId);
  return set === undefined ? [] : [...set];
}

export function socketsForSession(sessionId: string): SocketContext[] {
  const set = bySession.get(sessionId);
  return set === undefined ? [] : [...set];
}

export function allSockets(): SocketContext[] {
  return [...sockets];
}

export function resetRegistry(): void {
  sockets.clear();
  byUser.clear();
  bySession.clear();
}
