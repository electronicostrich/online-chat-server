import { describe, test, expect } from 'vitest';
import { deliverOrDrop, MAX_OUTBOUND_BUFFERED_BYTES } from '../../../src/modules/realtime/delivery.js';
import type {
  DeliverableSocket,
  OutboundEvent,
  SocketContext,
} from '../../../src/modules/realtime/types.js';

// `DeliverableSocket` is the narrow surface the delivery path reads
// and writes; a fake that implements exactly that interface is enough
// to exercise the buffered-bytes guard without spinning up a real
// websocket.
function fakeSocket(opts: { readyState?: number; bufferedAmount?: number }): {
  socket: DeliverableSocket;
  calls: { send: string[]; close: Array<{ code?: number; reason?: string }> };
} {
  const calls = { send: [] as string[], close: [] as Array<{ code?: number; reason?: string }> };
  const socket: DeliverableSocket = {
    readyState: opts.readyState ?? 1,
    bufferedAmount: opts.bufferedAmount ?? 0,
    send: (payload: string) => {
      calls.send.push(payload);
    },
    close: (code?: number, reason?: string) => {
      calls.close.push({ code, reason });
    },
  };
  return { socket, calls };
}

function ctxFor(socket: DeliverableSocket): SocketContext {
  return {
    sessionId: '00000000-0000-0000-0000-000000000000',
    userId: '00000000-0000-0000-0000-000000000000',
    socket,
    subscriptions: new Set(),
    lastHeartbeatAt: Date.now(),
    lastActivityAt: Date.now(),
  };
}

const event: OutboundEvent = {
  eventId: '11111111-1111-1111-1111-111111111111',
  type: 'message.created',
  occurredAt: '2026-04-19T00:00:00.000Z',
  payload: {
    chatId: '22222222-2222-2222-2222-222222222222',
    headSequence: 1,
    message: {
      id: '33333333-3333-3333-3333-333333333333',
      chatId: '22222222-2222-2222-2222-222222222222',
      sequence: 1,
      authorUserId: '44444444-4444-4444-4444-444444444444',
      kind: 'text',
      bodyText: 'hi',
      replyToMessageId: null,
      createdAt: '2026-04-19T00:00:00.000Z',
      editedAt: null,
      deletedAt: null,
    },
  },
};

describe('deliverOrDrop — AC-RT-06 bounded buffer', () => {
  test('sends payload when socket is open and buffer is under threshold', () => {
    const { socket, calls } = fakeSocket({ bufferedAmount: 0 });
    deliverOrDrop(ctxFor(socket), event);
    expect(calls.send.length).toBe(1);
    expect(calls.close.length).toBe(0);
    // The wire payload is JSON-encoded; parse to prove it's real, not a
    // tautology like `toBeTruthy()`.
    const parsed = JSON.parse(calls.send[0] ?? '{}') as OutboundEvent;
    expect(parsed.type).toBe('message.created');
    expect(parsed.eventId).toBe(event.eventId);
  });

  test('drops socket with SLOW_CONSUMER close code when projected buffer exceeds threshold', () => {
    // The guard is now projected (current + payload), so a buffer
    // already at the limit minus one byte will still trip when a
    // single event of any size is about to be pushed.
    const { socket, calls } = fakeSocket({
      bufferedAmount: MAX_OUTBOUND_BUFFERED_BYTES,
    });
    deliverOrDrop(ctxFor(socket), event);
    expect(calls.send.length).toBe(0);
    expect(calls.close.length).toBe(1);
    expect(calls.close[0]?.code).toBe(4408);
  });

  test('does NOT drop when the buffer has headroom for the next payload', () => {
    // Pick a buffer value just shy of the threshold by more than the
    // payload size so the projected-total guard lets this event
    // through.
    const { socket, calls } = fakeSocket({
      bufferedAmount: 1024,
    });
    deliverOrDrop(ctxFor(socket), event);
    expect(calls.send.length).toBe(1);
    expect(calls.close.length).toBe(0);
  });

  test('skips delivery when socket is already closing', () => {
    const { socket, calls } = fakeSocket({ readyState: 2, bufferedAmount: 0 });
    deliverOrDrop(ctxFor(socket), event);
    expect(calls.send.length).toBe(0);
    expect(calls.close.length).toBe(0);
  });
});
