import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import fastifyWebsocket from '@fastify/websocket';
import { WS_CLOSE_CODES } from 'shared-schemas';
import { requireSession } from '../auth/plugin.js';
import { userCanReadChat } from './authorization.js';
import { deliverOrDrop } from './delivery.js';
import { registerSocket, unregisterSocket } from './registry.js';
import type { SocketContext } from './types.js';

interface ClientCmd {
  id?: unknown;
  type?: unknown;
  payload?: { chatId?: unknown };
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

    const ctx: SocketContext = {
      sessionId: session.session.id,
      userId: session.user.id,
      socket,
      subscriptions: new Set(),
    };
    registerSocket(ctx);

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
    });

    socket.on('error', () => {
      unregisterSocket(ctx);
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
  if (cmdType === 'chat.subscribe') {
    const chatId = parsed.payload?.chatId;
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
    const chatId = parsed.payload?.chatId;
    if (!isUuid(chatId)) {
      sendCmdError(ctx, commandId, 'VALIDATION_ERROR', 'payload.chatId must be a UUID');
      return;
    }
    ctx.subscriptions.delete(chatId);
    sendAck(ctx, commandId, 'chat.unsubscribe.ack', chatId);
    return;
  }
  sendCmdError(ctx, commandId, 'VALIDATION_ERROR', `Unknown command type "${cmdType}"`);
}

export const realtimeGateway = fp(gatewayImpl, {
  name: 'realtime-gateway',
  dependencies: ['auth-plugin'],
});
