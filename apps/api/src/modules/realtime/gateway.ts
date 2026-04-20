import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import fastifyWebsocket from '@fastify/websocket';
import {
  SYNC_REQUEST_MAX_CHATS,
  WS_CLOSE_CODES,
  type SyncRequestChatEntry,
  type SyncResponseChatEntry,
} from 'shared-schemas';
import { requireSession } from '../auth/plugin.js';
import { userCanReadChat } from './authorization.js';
import { deliverOrDrop } from './delivery.js';
import {
  bumpSocket,
  publishPresenceIfChanged,
  startPresenceScanner,
  stopPresenceScanner,
} from './presence.js';
import { registerSocket, unregisterSocket } from './registry.js';
import { computeSyncAdviceForChat } from './sync.js';
import type { SocketContext } from './types.js';

interface ClientCmd {
  id?: unknown;
  type?: unknown;
  payload?: unknown;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function sendAck(
  ctx: SocketContext,
  commandId: string,
  type: 'chat.subscribe.ack' | 'chat.unsubscribe.ack',
  chatId: string,
): void {
  // Ack and error frames share the bounded-buffer delivery path with
  // domain events. Without this, a client spamming invalid commands
  // without reading could grow the outbound buffer past the guard
  // through this side channel.
  deliverOrDrop(ctx, {
    eventId: commandId,
    type,
    occurredAt: new Date().toISOString(),
    payload: { chatId },
  });
}

function sendCmdError(
  ctx: SocketContext,
  commandId: string,
  code: string,
  message: string,
): void {
  deliverOrDrop(ctx, {
    eventId: commandId,
    type: 'command.error',
    occurredAt: new Date().toISOString(),
    payload: { code, message },
  });
}

const gatewayImpl: FastifyPluginAsync = async (fastify) => {
  await fastify.register(fastifyWebsocket, {
    options: {
      maxPayload: 32 * 1024,
    },
  });

  startPresenceScanner();
  fastify.addHook('onClose', () => {
    stopPresenceScanner();
  });

  fastify.get('/ws', { websocket: true }, (socket, req) => {
    // The global auth preHandler (see modules/auth/plugin.ts) has already
    // resolved the session from the cookie; if it's missing the upgrade
    // happened unauthenticated, so close with a dedicated code.
    let session;
    try {
      session = requireSession(req);
    } catch {
      socket.close(WS_CLOSE_CODES.UNAUTHENTICATED, 'unauthenticated');
      return;
    }

    // Connect is treated as activity so a freshly opened tab starts
    // online rather than AFK. Subsequent transitions come from
    // presence.heartbeat / presence.activity / the periodic scan.
    const now = Date.now();
    const ctx: SocketContext = {
      sessionId: session.session.id,
      userId: session.user.id,
      socket,
      subscriptions: new Set(),
      lastHeartbeatAt: now,
      lastActivityAt: now,
    };
    registerSocket(ctx);
    void publishPresenceIfChanged(ctx.userId).catch((err: unknown) => {
      fastify.log.warn({ err }, 'realtime: presence publish on connect failed');
    });

    socket.on('message', (raw) => {
      // Fire-and-forget async handler — errors surface as `command.error`.
      void handleMessage(ctx, raw).catch((err: unknown) => {
        fastify.log.warn(
          { err },
          'realtime: unhandled error dispatching client command',
        );
      });
    });

    socket.on('close', () => {
      unregisterSocket(ctx);
      void publishPresenceIfChanged(ctx.userId).catch((err: unknown) => {
        fastify.log.warn(
          { err },
          'realtime: presence publish on close failed',
        );
      });
    });

    socket.on('error', () => {
      unregisterSocket(ctx);
      void publishPresenceIfChanged(ctx.userId).catch((err: unknown) => {
        fastify.log.warn(
          { err },
          'realtime: presence publish on error failed',
        );
      });
    });
  });
};

function isClientCmd(value: unknown): value is ClientCmd {
  // JSON.parse can return `null`, numbers, booleans, strings, or
  // arrays — all typeof-object-either-false or non-object. Narrow to
  // a non-null object first so property probing below is safe.
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function handleMessage(
  ctx: SocketContext,
  raw: Buffer | ArrayBuffer | Buffer[],
): Promise<void> {
  const text = Buffer.isBuffer(raw)
    ? raw.toString('utf-8')
    : Array.isArray(raw)
      ? Buffer.concat(raw).toString('utf-8')
      : Buffer.from(raw).toString('utf-8');
  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(text);
  } catch {
    sendCmdError(ctx, 'unknown', 'VALIDATION_ERROR', 'Command is not valid JSON');
    return;
  }
  if (!isClientCmd(rawParsed)) {
    sendCmdError(ctx, 'unknown', 'VALIDATION_ERROR', 'Command must be a JSON object');
    return;
  }
  const parsed: ClientCmd = rawParsed;
  const commandId =
    typeof parsed.id === 'string' && parsed.id.length > 0 ? parsed.id : 'unknown';
  const cmdType = typeof parsed.type === 'string' ? parsed.type : '';
  const payload =
    typeof parsed.payload === 'object' &&
    parsed.payload !== null &&
    !Array.isArray(parsed.payload)
      ? (parsed.payload as Record<string, unknown>)
      : undefined;
  // Any command frame proves the tab is still running JS — bump
  // heartbeat for staleness. `presence.activity` additionally bumps
  // `lastActivityAt`; see presence.ts for the aggregation rules.
  bumpSocket(ctx, cmdType === 'presence.activity');
  if (cmdType === 'chat.subscribe') {
    const chatId = payload?.chatId;
    if (!isUuid(chatId)) {
      sendCmdError(ctx, commandId, 'VALIDATION_ERROR', 'payload.chatId must be a UUID');
      return;
    }
    if (!(await userCanReadChat(chatId, ctx.userId))) {
      sendCmdError(ctx, commandId, 'FORBIDDEN', 'No access to this chat');
      return;
    }
    ctx.subscriptions.add(chatId);
    sendAck(ctx, commandId, 'chat.subscribe.ack', chatId);
    return;
  }
  if (cmdType === 'chat.unsubscribe') {
    const chatId = payload?.chatId;
    if (!isUuid(chatId)) {
      sendCmdError(ctx, commandId, 'VALIDATION_ERROR', 'payload.chatId must be a UUID');
      return;
    }
    ctx.subscriptions.delete(chatId);
    sendAck(ctx, commandId, 'chat.unsubscribe.ack', chatId);
    return;
  }
  if (cmdType === 'sync.request') {
    await handleSyncRequest(ctx, commandId, payload);
    return;
  }
  if (cmdType === 'presence.heartbeat' || cmdType === 'presence.activity') {
    // bumpSocket already recorded the activity/heartbeat; republish
    // presence so a tab returning from AFK surfaces immediately
    // without waiting for the next scan tick.
    await publishPresenceIfChanged(ctx.userId);
    return;
  }
  sendCmdError(ctx, commandId, 'VALIDATION_ERROR', `Unknown command type "${cmdType}"`);
}

function parseSyncEntries(
  rawChats: unknown,
): { ok: true; entries: SyncRequestChatEntry[] } | { ok: false; message: string } {
  if (!Array.isArray(rawChats)) {
    return { ok: false, message: 'payload.chats must be an array' };
  }
  if (rawChats.length > SYNC_REQUEST_MAX_CHATS) {
    return {
      ok: false,
      message: `payload.chats exceeds the ${SYNC_REQUEST_MAX_CHATS.toString()}-chat cap`,
    };
  }
  const entries: SyncRequestChatEntry[] = [];
  const seen = new Set<string>();
  for (const raw of rawChats) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { ok: false, message: 'payload.chats entries must be objects' };
    }
    const entry = raw as Record<string, unknown>;
    const chatId = entry.chatId;
    if (!isUuid(chatId)) {
      return { ok: false, message: 'payload.chats[].chatId must be a UUID' };
    }
    if (seen.has(chatId)) {
      return { ok: false, message: 'payload.chats contains duplicate chatId entries' };
    }
    seen.add(chatId);
    const last = entry.lastKnownContiguousSequence;
    const read = entry.lastKnownReadSequence;
    if (
      typeof last !== 'number' ||
      !Number.isInteger(last) ||
      last < 0 ||
      typeof read !== 'number' ||
      !Number.isInteger(read) ||
      read < 0
    ) {
      return {
        ok: false,
        message:
          'payload.chats[].lastKnownContiguousSequence and lastKnownReadSequence must be non-negative integers',
      };
    }
    entries.push({
      chatId,
      lastKnownContiguousSequence: last,
      lastKnownReadSequence: read,
    });
  }
  return { ok: true, entries };
}

async function handleSyncRequest(
  ctx: SocketContext,
  commandId: string,
  payload: Record<string, unknown> | undefined,
): Promise<void> {
  const parsed = parseSyncEntries(payload?.chats);
  if (!parsed.ok) {
    sendCmdError(ctx, commandId, 'VALIDATION_ERROR', parsed.message);
    return;
  }
  // Per-chat advice is computed sequentially rather than in parallel so
  // a caller cannot fan-out a 200-chat sync into 200 simultaneous DB
  // hits. The work per chat is small (two indexed queries) and the
  // realtime path is latency-tolerant under reconnect load.
  const chats: SyncResponseChatEntry[] = [];
  for (const entry of parsed.entries) {
    const decision = await computeSyncAdviceForChat(ctx.userId, entry);
    chats.push(decision);
  }
  deliverOrDrop(ctx, {
    eventId: randomUUID(),
    type: 'sync.response',
    occurredAt: new Date().toISOString(),
    payload: { replyToCommandId: commandId, chats },
  });
}

export const realtimeGateway = fp(gatewayImpl, {
  name: 'realtime-gateway',
  dependencies: ['auth-plugin'],
});
