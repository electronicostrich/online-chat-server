import { WS_CLOSE_CODES } from 'shared-schemas';
import { unregisterSocket } from './registry.js';
import type { OutboundEvent, SocketContext } from './types.js';

// AC-RT-06: a slow consumer must not force unbounded memory growth.
// `ws` buffers unsent bytes in `bufferedAmount`; if that crosses the
// threshold we close the socket with a dedicated code and let the
// client repair state via REST on reconnect. The threshold is a byte
// count, not a message count, because typical events are small but a
// burst of message.created events plus a slow link can still pile up
// into megabytes before the OS-level socket buffer would notice.
export const MAX_OUTBOUND_BUFFERED_BYTES = 256 * 1024;

export function deliverOrDrop(ctx: SocketContext, event: OutboundEvent): void {
  const payload = JSON.stringify(event);
  const socket = ctx.socket;
  // `readyState` is a numeric enum on the underlying `ws` socket: 1 =
  // OPEN. If the socket is closing/closed we skip delivery — the close
  // handler will clean up the registry momentarily.
  if (socket.readyState !== 1) return;
  // Compare against projected buffered bytes (current + this payload)
  // so a single oversized event can't slip past the guard.
  const payloadBytes = Buffer.byteLength(payload);
  if (socket.bufferedAmount + payloadBytes > MAX_OUTBOUND_BUFFERED_BYTES) {
    try {
      socket.close(WS_CLOSE_CODES.SLOW_CONSUMER, 'slow consumer');
    } catch {
      // Socket already torn down — nothing more to do.
    }
    unregisterSocket(ctx);
    return;
  }
  try {
    socket.send(payload);
  } catch {
    // Best-effort send. If it fails the close handler will run.
  }
}
