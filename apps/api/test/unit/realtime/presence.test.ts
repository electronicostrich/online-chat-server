import { describe, test, expect, beforeEach, beforeAll, vi } from 'vitest';

// presence.ts imports config/env.ts, which throws at import-time if
// required env isn't populated. Satisfy the typebox length minimums
// with fixture values — same pattern as seed.test.ts. The actual
// module imports are done lazily inside `beforeAll` so this assignment
// runs first.
process.env.NODE_ENV ??= 'development';
process.env.DATABASE_URL ??= 'postgres://unit-test@localhost/presence-test';
process.env.REDIS_URL ??= 'redis://localhost:6379/0';
process.env.SESSION_SECRET ??= 'a'.repeat(32);
process.env.CSRF_SECRET ??= 'b'.repeat(32);
process.env.ALLOWED_ORIGINS ??= 'http://localhost:5173';

// The observer lookup hits Drizzle in production; in unit tests we
// don't have a DB, so stub it to return just the subject. Keeps the
// aggregation tests focused on the timer/heartbeat logic.
vi.mock('../../../src/modules/realtime/presence-observers.js', () => ({
  listPresenceObserverIds: (userId: string) =>
    Promise.resolve(new Set<string>([userId])),
}));

import type * as PresenceModule from '../../../src/modules/realtime/presence.js';
import type * as RegistryModule from '../../../src/modules/realtime/registry.js';
import type {
  DeliverableSocket,
  SocketContext,
} from '../../../src/modules/realtime/types.js';

// Late-bound presence module so the process.env assignments above run
// before env validation at config import-time.
let presence: typeof PresenceModule;
let registry: typeof RegistryModule;

interface FakeSocket extends DeliverableSocket {
  readonly sent: string[];
  readonly closes: Array<{ code?: number }>;
}

function makeSocket(): FakeSocket {
  const sent: string[] = [];
  const closes: Array<{ code?: number }> = [];
  return {
    readyState: 1,
    bufferedAmount: 0,
    send: (payload) => {
      sent.push(payload);
    },
    close: (code) => {
      closes.push({ code });
    },
    get sent() {
      return sent;
    },
    get closes() {
      return closes;
    },
  };
}

function attach(opts: {
  userId: string;
  sessionId: string;
  lastHeartbeatAt: number;
  lastActivityAt: number;
}): { ctx: SocketContext; socket: FakeSocket } {
  const socket = makeSocket();
  const ctx: SocketContext = {
    userId: opts.userId,
    sessionId: opts.sessionId,
    socket,
    subscriptions: new Set(),
    lastHeartbeatAt: opts.lastHeartbeatAt,
    lastActivityAt: opts.lastActivityAt,
  };
  registry.registerSocket(ctx);
  return { ctx, socket };
}

describe('presence aggregation — AC-PRES-01..04', () => {
  beforeAll(async () => {
    presence = await import('../../../src/modules/realtime/presence.js');
    registry = await import('../../../src/modules/realtime/registry.js');
  });

  const timers = {
    afkThresholdMs: 60_000,
    staleThresholdMs: 45_000,
    scanIntervalMs: 5_000,
  } as const;

  beforeEach(() => {
    registry.resetRegistry();
    presence.resetPresencePublishedCache();
  });

  test('AC-PRES-01: any live tab with recent activity → online', () => {
    const now = 1_000_000;
    // Three tabs for the same user: one fresh (online), one idle past
    // AFK threshold, one stale. Aggregate MUST be `online` because the
    // first tab proves recent activity.
    attach({
      userId: 'u-1',
      sessionId: 's-a',
      lastHeartbeatAt: now - 1_000,
      lastActivityAt: now - 1_000,
    });
    attach({
      userId: 'u-1',
      sessionId: 's-b',
      lastHeartbeatAt: now - 10_000,
      lastActivityAt: now - 65_000,
    });
    attach({
      userId: 'u-1',
      sessionId: 's-c',
      lastHeartbeatAt: now - 50_000,
      lastActivityAt: now - 50_000,
    });
    expect(presence.computeUserPresence('u-1', now, timers)).toBe('online');
  });

  test('AC-PRES-02: all live tabs idle beyond threshold → afk', () => {
    const now = 2_000_000;
    // Two live tabs but both idle > 60s. No stale tabs. Aggregate MUST
    // be `afk` — not offline (tabs still alive) and not online (no
    // activity within the window).
    attach({
      userId: 'u-2',
      sessionId: 's-a',
      lastHeartbeatAt: now - 5_000,
      lastActivityAt: now - 61_000,
    });
    attach({
      userId: 'u-2',
      sessionId: 's-b',
      lastHeartbeatAt: now - 20_000,
      lastActivityAt: now - 90_000,
    });
    expect(presence.computeUserPresence('u-2', now, timers)).toBe('afk');
  });

  test('AC-PRES-03: no live non-stale tabs → offline', () => {
    const now = 3_000_000;
    // Two tabs registered but BOTH past the stale heartbeat window. A
    // stale tab doesn't hold the user online.
    attach({
      userId: 'u-3',
      sessionId: 's-a',
      lastHeartbeatAt: now - 46_000,
      lastActivityAt: now - 46_000,
    });
    attach({
      userId: 'u-3',
      sessionId: 's-b',
      lastHeartbeatAt: now - 60_000,
      lastActivityAt: now - 60_000,
    });
    expect(presence.computeUserPresence('u-3', now, timers)).toBe('offline');
  });

  test('AC-PRES-04: scan closes stale socket and keeps fresh tab', async () => {
    const now = 4_000_000;
    // Fresh tab first, then a tab that hasn't heartbeat'd in 46s.
    // Running the scan must close the stale tab with STALE_CONNECTION
    // (4410) and leave the fresh tab registered.
    const fresh = attach({
      userId: 'u-4',
      sessionId: 's-a',
      lastHeartbeatAt: now - 1_000,
      lastActivityAt: now - 1_000,
    });
    const stale = attach({
      userId: 'u-4',
      sessionId: 's-b',
      lastHeartbeatAt: now - 46_000,
      lastActivityAt: now - 46_000,
    });

    await presence.runPresenceScan(timers, now);

    expect(stale.socket.closes.length).toBe(1);
    expect(stale.socket.closes[0]?.code).toBe(4410);
    expect(fresh.socket.closes.length).toBe(0);
    const remaining = registry.socketsForUser('u-4');
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.sessionId).toBe('s-a');
  });

  test('AC-PRES-04 part 2: scan removes last stale tab so user reads as offline', async () => {
    const now = 5_000_000;
    attach({
      userId: 'u-5',
      sessionId: 's-a',
      lastHeartbeatAt: now - 50_000,
      lastActivityAt: now - 50_000,
    });
    await presence.runPresenceScan(timers, now);
    expect(registry.socketsForUser('u-5').length).toBe(0);
    expect(presence.computeUserPresence('u-5', now, timers)).toBe('offline');
  });
});
