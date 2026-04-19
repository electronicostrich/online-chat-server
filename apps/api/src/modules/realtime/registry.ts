import type { SocketContext } from './types.js';

// In-process registry of live websocket connections. Production-grade
// realtime deployments fan out across nodes via Redis pub/sub — that's
// WS-01's job. For now the MVP runs on a single Fastify instance, so a
// Set keyed by socket ctx is enough. When the Redis layer lands the
// fan-out call sites here become the only place that needs to change.
const sockets = new Set<SocketContext>();
const byUser = new Map<string, Set<SocketContext>>();
const bySession = new Map<string, SocketContext>();

export function registerSocket(ctx: SocketContext): void {
  sockets.add(ctx);
  let userSet = byUser.get(ctx.userId);
  if (userSet === undefined) {
    userSet = new Set();
    byUser.set(ctx.userId, userSet);
  }
  userSet.add(ctx);
  bySession.set(ctx.sessionId, ctx);
}

export function unregisterSocket(ctx: SocketContext): void {
  sockets.delete(ctx);
  const userSet = byUser.get(ctx.userId);
  if (userSet !== undefined) {
    userSet.delete(ctx);
    if (userSet.size === 0) byUser.delete(ctx.userId);
  }
  const bound = bySession.get(ctx.sessionId);
  if (bound === ctx) bySession.delete(ctx.sessionId);
}

export function socketsForUser(userId: string): SocketContext[] {
  const set = byUser.get(userId);
  return set === undefined ? [] : [...set];
}

export function socketForSession(sessionId: string): SocketContext | undefined {
  return bySession.get(sessionId);
}

export function allSockets(): SocketContext[] {
  return [...sockets];
}

export function resetRegistry(): void {
  sockets.clear();
  byUser.clear();
  bySession.clear();
}
