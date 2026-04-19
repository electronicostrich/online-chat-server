import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import fastifyWebsocket from '@fastify/websocket';
import type { WebSocket } from '@fastify/websocket';
import { WS_CLOSE_CODES } from 'shared-schemas';
import { requireSession } from '../auth/plugin.js';
import {
  loadChatContext,
  isActiveRoomMember,
} from '../messages/repository.js';
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

async function userCanReadChat(chatId: string, userId: string): Promise<boolean> {
  const ctx = await loadChatContext(chatId);
  if (ctx === undefined) return false;
  if (ctx.chat.type === 'room') {
    const membership = await isActiveRoomMember(chatId, userId);
    return membership !== undefined;
  }
  return (
    ctx.directParticipantIds !== null && ctx.directParticipantIds.includes(userId)
  );
}

function sendAck(
  socket: WebSocket | SocketContext['socket'],
  commandId: string,
  type: 'chat.subscribe.ack' | 'chat.unsubscribe.ack',
  chatId: string,
): void {
  // Ack is a best-effort courtesy reply; if the send fails the socket
  // is about to be torn down anyway.
  try {
    socket.send(
      JSON.stringify({
        eventId: commandId,
        type,
        occurredAt: new Date().toISOString(),
        payload: { chatId },
      }),
    );
  } catch {
    // Ignore — socket is dying.
  }
}

function sendCmdError(
  socket: WebSocket | SocketContext['socket'],
  commandId: string,
  code: string,
  message: string,
): void {
  try {
    socket.send(
      JSON.stringify({
        eventId: commandId,
        type: 'command.error',
        occurredAt: new Date().toISOString(),
        payload: { code, message },
      }),
    );
  } catch {
    // Ignore — socket is dying.
  }
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

async function handleMessage(
  ctx: SocketContext,
  raw: Buffer | ArrayBuffer | Buffer[],
): Promise<void> {
  const text = Buffer.isBuffer(raw)
    ? raw.toString('utf-8')
    : Array.isArray(raw)
      ? Buffer.concat(raw).toString('utf-8')
      : Buffer.from(raw).toString('utf-8');
  let parsed: ClientCmd;
  try {
    parsed = JSON.parse(text) as ClientCmd;
  } catch {
    sendCmdError(ctx.socket, 'unknown', 'VALIDATION_ERROR', 'Command is not valid JSON');
    return;
  }
  const commandId =
    'id' in parsed && typeof parsed.id === 'string' && parsed.id.length > 0
      ? parsed.id
      : 'unknown';
  const cmdType = typeof parsed.type === 'string' ? parsed.type : '';
  if (cmdType === 'chat.subscribe') {
    const chatId = parsed.payload?.chatId;
    if (!isUuid(chatId)) {
      sendCmdError(ctx.socket, commandId, 'VALIDATION_ERROR', 'payload.chatId must be a UUID');
      return;
    }
    if (!(await userCanReadChat(chatId, ctx.userId))) {
      sendCmdError(ctx.socket, commandId, 'FORBIDDEN', 'No access to this chat');
      return;
    }
    ctx.subscriptions.add(chatId);
    sendAck(ctx.socket, commandId, 'chat.subscribe.ack', chatId);
    return;
  }
  if (cmdType === 'chat.unsubscribe') {
    const chatId = parsed.payload?.chatId;
    if (!isUuid(chatId)) {
      sendCmdError(ctx.socket, commandId, 'VALIDATION_ERROR', 'payload.chatId must be a UUID');
      return;
    }
    ctx.subscriptions.delete(chatId);
    sendAck(ctx.socket, commandId, 'chat.unsubscribe.ack', chatId);
    return;
  }
  sendCmdError(ctx.socket, commandId, 'VALIDATION_ERROR', `Unknown command type "${cmdType}"`);
}

export const realtimeGateway = fp(gatewayImpl, {
  name: 'realtime-gateway',
  dependencies: ['auth-plugin'],
});
