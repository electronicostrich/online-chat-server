import WebSocket from 'ws';
import type { APIResponse } from '@playwright/test';

interface ConnectOptions {
  cookieHeader: string;
  baseURL?: string;
}

export interface WsClient {
  ws: WebSocket;
  nextEvent: (
    predicate?: (ev: ReceivedEvent) => boolean,
    timeoutMs?: number,
  ) => Promise<ReceivedEvent>;
  collectUntilClosed: () => Promise<ReceivedEvent[]>;
  send: (obj: unknown) => void;
  close: () => Promise<void>;
  closeInfo: () => { code: number; reason: string } | undefined;
}

export interface ReceivedEvent {
  eventId?: string;
  type: string;
  occurredAt?: string;
  payload?: unknown;
}

// Turn the Set-Cookie header returned by register()/login() into a single
// `Cookie` request header. The websocket upgrade doesn't get to run cookie
// jars, so we forward the cookies the test context would have sent.
export function cookieHeaderFromSetCookie(resp: APIResponse): string {
  const setCookie = resp.headers()['set-cookie'] ?? '';
  const pairs: string[] = [];
  for (const chunk of setCookie.split(/\n|,(?=[^ ])/u)) {
    const eq = chunk.indexOf('=');
    if (eq === -1) continue;
    const name = chunk.slice(0, eq).trim();
    const valueRaw = chunk.slice(eq + 1);
    const semi = valueRaw.indexOf(';');
    const value = (semi === -1 ? valueRaw : valueRaw.slice(0, semi)).trim();
    if (name.length > 0 && value.length > 0) {
      pairs.push(`${name}=${value}`);
    }
  }
  return pairs.join('; ');
}

export async function connectWebSocket(
  opts: ConnectOptions,
): Promise<WsClient> {
  const baseURL = opts.baseURL ?? 'ws://localhost:3000';
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${baseURL}/ws`, {
      headers: { cookie: opts.cookieHeader },
    });
    const queue: ReceivedEvent[] = [];
    interface Waiter {
      predicate?: (ev: ReceivedEvent) => boolean;
      resolve: (ev: ReceivedEvent) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
    const waiters: Waiter[] = [];
    let closeInfo: { code: number; reason: string } | undefined;

    const pushEvent = (ev: ReceivedEvent): void => {
      for (let i = 0; i < waiters.length; i++) {
        const w = waiters[i];
        if (w === undefined) continue;
        if (w.predicate === undefined || w.predicate(ev)) {
          clearTimeout(w.timer);
          waiters.splice(i, 1);
          w.resolve(ev);
          return;
        }
      }
      queue.push(ev);
    };

    ws.on('open', () => {
      const client: WsClient = {
        ws,
        send: (obj) => {
          ws.send(JSON.stringify(obj));
        },
        nextEvent: (predicate, timeoutMs = 5_000) =>
          new Promise((res, rej) => {
            // Reject synchronously if the socket has already closed,
            // otherwise the caller would register a waiter that can
            // only time out instead of surfacing the real close code.
            if (
              closeInfo !== undefined ||
              ws.readyState === ws.CLOSING ||
              ws.readyState === ws.CLOSED
            ) {
              const code = closeInfo?.code ?? 1006;
              rej(new Error(`WS closed before event (code=${code.toString()})`));
              return;
            }
            for (let i = 0; i < queue.length; i++) {
              const ev = queue[i];
              if (ev === undefined) continue;
              if (predicate === undefined || predicate(ev)) {
                queue.splice(i, 1);
                res(ev);
                return;
              }
            }
            const timer = setTimeout(() => {
              const idx = waiters.findIndex((w) => w.timer === timer);
              if (idx >= 0) waiters.splice(idx, 1);
              rej(new Error('WS nextEvent timeout'));
            }, timeoutMs);
            const entry: Waiter = { resolve: res, reject: rej, timer };
            if (predicate !== undefined) entry.predicate = predicate;
            waiters.push(entry);
          }),
        collectUntilClosed: () =>
          new Promise((res) => {
            const collected: ReceivedEvent[] = [...queue];
            queue.length = 0;
            const onMsg = (buf: Buffer): void => {
              try {
                const parsed = JSON.parse(buf.toString('utf-8')) as ReceivedEvent;
                collected.push(parsed);
              } catch {
                // Ignore malformed frames in the test helper — mirrors
                // the behaviour of the main message handler above.
              }
            };
            ws.on('message', onMsg);
            ws.once('close', () => {
              ws.off('message', onMsg);
              res(collected);
            });
          }),
        close: () =>
          new Promise((res) => {
            if (ws.readyState === ws.CLOSED) {
              res();
              return;
            }
            ws.once('close', () => {
              res();
            });
            ws.close();
          }),
        closeInfo: () => closeInfo,
      };
      resolve(client);
    });

    ws.on('message', (buf: Buffer) => {
      try {
        const text = buf.toString('utf-8');
        const parsed = JSON.parse(text) as ReceivedEvent;
        pushEvent(parsed);
      } catch {
        // Ignore malformed frames in the test helper.
      }
    });

    ws.on('error', (err) => {
      reject(err);
    });

    ws.on('close', (code, reasonBuf) => {
      closeInfo = { code, reason: Buffer.from(reasonBuf).toString('utf-8') };
      for (const w of waiters) {
        clearTimeout(w.timer);
        w.reject(new Error(`WS closed before event (code=${code.toString()})`));
      }
      waiters.length = 0;
    });
  });
}
