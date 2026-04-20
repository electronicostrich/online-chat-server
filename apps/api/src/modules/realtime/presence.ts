import { randomUUID } from 'node:crypto';
import type { PresenceState, PresenceUpdatedPayload } from 'shared-schemas';
import { WS_CLOSE_CODES } from 'shared-schemas';
import { config } from '../../config/env.js';
import { listPresenceObserverIds } from './presence-observers.js';
import { deliverOrDrop } from './delivery.js';
import {
  allSockets,
  socketsForUser,
  unregisterSocket,
} from './registry.js';
import type { OutboundEvent, SocketContext } from './types.js';

// AC-PRES-01..04. Presence is derived per user from the live sockets
// registered for that user. The aggregation lives here so the gateway,
// the heartbeat handler, and the periodic stale-sweep all share one
// source of truth for the transitions documented in state-model.md §5.
//
// - `online` = at least one live socket whose `lastActivityAt` is
//   within the AFK window
// - `afk`    = at least one live socket remains, but none has recent
//   activity
// - `offline`= no live sockets (every tab is disconnected or stale)
//
// "Live" excludes sockets flagged stale by the sweep below; staleness
// is driven by `lastHeartbeatAt` (AC-PRES-04, hibernated tab eventually
// rolls off). A socket that never heard a heartbeat from the client
// still counts as live until the stale threshold, because connect
// itself bumps the heartbeat.

export interface PresenceTimers {
  afkThresholdMs: number;
  staleThresholdMs: number;
  scanIntervalMs: number;
}

export function defaultPresenceTimers(): PresenceTimers {
  return {
    afkThresholdMs: config.WEBSOCKET_AFK_THRESHOLD_MS,
    staleThresholdMs: config.WEBSOCKET_STALE_TIMEOUT_MS,
    scanIntervalMs: config.WEBSOCKET_PRESENCE_SCAN_INTERVAL_MS,
  };
}

// Last presence value published per user. Used so we only fan out
// `presence.updated` on actual state transitions — otherwise every
// scan tick would spam observers with redundant events.
const lastPublishedByUser = new Map<string, PresenceState>();

function aggregate(
  sockets: SocketContext[],
  now: number,
  timers: PresenceTimers,
): PresenceState {
  if (sockets.length === 0) return 'offline';
  let hasLive = false;
  let hasActive = false;
  for (const s of sockets) {
    if (now - s.lastHeartbeatAt > timers.staleThresholdMs) continue;
    hasLive = true;
    if (now - s.lastActivityAt <= timers.afkThresholdMs) {
      hasActive = true;
      break;
    }
  }
  if (!hasLive) return 'offline';
  return hasActive ? 'online' : 'afk';
}

export function computeUserPresence(
  userId: string,
  now: number = Date.now(),
  timers: PresenceTimers = defaultPresenceTimers(),
): PresenceState {
  return aggregate(socketsForUser(userId), now, timers);
}

// Internal: emit `presence.updated` to every live socket whose owner
// is allowed to observe this user's presence (permissions-matrix.md §4
// — self, friends, and co-room members). The event also goes to the
// user's own sockets so the client can reflect self-state (e.g., the
// sessions screen's "this tab is AFK" badge).
async function fanOutPresenceUpdated(
  userId: string,
  presence: PresenceState,
): Promise<void> {
  const payload: PresenceUpdatedPayload = { userId, presence };
  const event: OutboundEvent = {
    eventId: randomUUID(),
    type: 'presence.updated',
    occurredAt: new Date().toISOString(),
    payload,
  };
  const observerIds = await listPresenceObserverIds(userId);
  // Self observes its own presence so the client can render its own
  // state without a second query; `observerIds` already includes
  // userId via the self-row.
  for (const observer of observerIds) {
    for (const ctx of socketsForUser(observer)) {
      deliverOrDrop(ctx, event);
    }
  }
}

export async function publishPresenceIfChanged(
  userId: string,
  timers: PresenceTimers = defaultPresenceTimers(),
  now: number = Date.now(),
): Promise<void> {
  const next = aggregate(socketsForUser(userId), now, timers);
  const prev = lastPublishedByUser.get(userId);
  if (prev === next) return;
  // Skip the initial "becoming offline" transition for a user we've
  // never announced — an observer that doesn't know this user exists
  // shouldn't get a phantom offline event. Returning without writing
  // the map keeps the key absent so later transitions are treated as
  // fresh announcements (offline is the implicit default, not a
  // cached state).
  if (prev === undefined && next === 'offline') return;
  await fanOutPresenceUpdated(userId, next);
  // Advance the cache only AFTER the fan-out actually succeeds;
  // otherwise an observer-lookup failure would mark the transition as
  // sent and suppress every retry while the user stays in the same
  // state. For terminal `offline` we delete the key so the map doesn't
  // accumulate one entry per user who has ever connected (sweep cost
  // stays proportional to active users, not historical traffic).
  if (next === 'offline') {
    lastPublishedByUser.delete(userId);
  } else {
    lastPublishedByUser.set(userId, next);
  }
}

// A socket-level command has arrived — call this from the gateway on
// every client → server frame that proves the tab is still running JS.
// `activity` is true when the command is `presence.activity` or an
// intentional interaction (message send, etc.); `false` is passed by
// bare heartbeats and subscribe/unsubscribe traffic.
export function bumpSocket(
  ctx: SocketContext,
  activity: boolean,
  now: number = Date.now(),
): void {
  ctx.lastHeartbeatAt = now;
  if (activity) ctx.lastActivityAt = now;
}

// Single sweep pass: close sockets whose last heartbeat is older than
// the stale threshold, then republish presence for every user whose
// aggregate value just changed. Exposed for tests so they can drive
// the loop in lockstep instead of waiting on a real interval.
export async function runPresenceScan(
  timers: PresenceTimers = defaultPresenceTimers(),
  now: number = Date.now(),
): Promise<void> {
  const affectedUsers = new Set<string>();
  for (const ctx of allSockets()) {
    if (now - ctx.lastHeartbeatAt > timers.staleThresholdMs) {
      affectedUsers.add(ctx.userId);
      try {
        ctx.socket.close(WS_CLOSE_CODES.STALE_CONNECTION, 'stale');
      } catch {
        // Socket already torn down — nothing more to do.
      }
      unregisterSocket(ctx);
      continue;
    }
    // Even non-stale sockets can cause a presence flip — a tab that was
    // active 59s ago becomes AFK at 60s even without disconnecting.
    affectedUsers.add(ctx.userId);
  }
  // Include users who have disappeared from the registry (all tabs
  // closed) but whose last announced presence was still online/afk —
  // they still need one final `presence.updated` with `offline`.
  // `lastPublishedByUser` only holds non-offline entries (the publish
  // path deletes the key on the offline transition), so every entry
  // found here is a real candidate for the offline announcement.
  for (const userId of lastPublishedByUser.keys()) {
    if (socketsForUser(userId).length === 0) {
      affectedUsers.add(userId);
    }
  }
  for (const userId of affectedUsers) {
    await publishPresenceIfChanged(userId, timers, now);
  }
}

// Long-running timer. Started once per Fastify instance via the
// realtime plugin's onReady hook; stopped via onClose. Exported for
// tests that want to drive the scan deterministically.
let scanTimer: NodeJS.Timeout | undefined;

export function startPresenceScanner(timers: PresenceTimers = defaultPresenceTimers()): void {
  if (scanTimer !== undefined) return;
  scanTimer = setInterval(() => {
    void runPresenceScan(timers).catch(() => {
      // Swallow sweep errors rather than letting a single failing tick
      // tear down the Node process. Individual delivery failures are
      // already handled by deliverOrDrop; observer-lookup failures are
      // the only other source, and a retry will happen next tick.
    });
  }, timers.scanIntervalMs);
  // Unref so the timer doesn't keep the process alive in tests that
  // legitimately expect clean shutdown.
  scanTimer.unref();
}

export function stopPresenceScanner(): void {
  if (scanTimer === undefined) return;
  clearInterval(scanTimer);
  scanTimer = undefined;
}

// Test helper: wipe the last-published cache so a re-run doesn't
// suppress events that the fresh scenario should emit.
export function resetPresencePublishedCache(): void {
  lastPublishedByUser.clear();
}
