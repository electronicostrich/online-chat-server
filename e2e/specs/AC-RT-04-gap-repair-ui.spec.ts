import { expect, test, request as apiRequest } from '@playwright/test';
import { csrfHeaders, login } from '../utils/auth.js';
import {
  createRoomViaUi,
  newSeededUser,
  seedTruncateAndCreate,
  signInViaUi,
  withApiContext,
} from '../utils/ui-auth.js';

// AC-RT-02 / AC-RT-04 (UI surface) — when a browser loses its websocket and
// reconnects, the SPA must issue sync.request and repair any gap via HTTP
// history before declaring itself in-sync. Concretely: if three messages
// were posted to a subscribed chat while the socket was down, those three
// messages must appear in the list after reconnect without the user having
// to reload the page or refetch manually.
//
// The test drives the UI through the browser (so the AppShell's real
// realtime client runs), uses `context.setOffline` to force the socket
// closed, and posts the "missed" messages through a parallel HTTP context
// while the SPA is offline. When the browser comes back online the
// reconnect loop in `apps/web/src/realtime/client.ts` fires the
// sync.request; the server replies with `fetch-history` + rangeHint; the
// ChatView's backfill pulls the missing rows via GET /chats/{id}/messages
// and merges them into the cache.
test.describe('AC-RT-04 (UI): SPA backfills gap via sync.response rangeHint', () => {
  test('messages posted while socket is offline appear after reconnect', async ({
    page,
    context,
  }) => {
    const owner = newSeededUser('owner');
    const other = newSeededUser('other');
    await withApiContext(async (api) => {
      await seedTruncateAndCreate(api, [owner, other]);
    });

    await signInViaUi(page, owner);
    const chatId = await createRoomViaUi(page, `gap-${Date.now().toString(36)}`);

    // Seed two in-sync messages so the client's contiguous tip is > 0 and
    // the server-side `fetch-history` branch has a non-trivial rangeHint
    // to emit (rangeHint.fromSequence = lastKnown + 1 = 3).
    const composerInput = page.getByTestId('composer-input');
    const composerSend = page.getByTestId('composer-send');
    for (let i = 1; i <= 2; i += 1) {
      await composerInput.fill(`seed-${i.toString()}`);
      await composerSend.click();
      await expect(composerInput).toHaveValue('');
    }
    await expect(page.getByTestId('message')).toHaveCount(2);

    // Promote `other` into the room so their writes to this chat are
    // accepted. Uses the `/__test/seed` append strategy rather than a real
    // invite+accept flow since that UI surface is still deferred.
    await withApiContext(async (api) => {
      const res = await api.post('/__test/seed', {
        data: {
          strategy: 'append',
          roomMembershipsByChatId: [
            { chatId, username: other.username, role: 'member' },
          ],
        },
      });
      if (res.status() !== 200) {
        throw new Error(`seed append failed: ${res.status().toString()}`);
      }
    });

    // Force the browser's websocket closed so subsequent message.created
    // events are not delivered live. The client's reconnect backoff stays
    // armed; it will retry once we flip offline back off.
    await context.setOffline(true);

    // Post three messages through a parallel HTTP context. These land in
    // the chat (sequences 3,4,5) but never reach the SPA via the socket —
    // the only way they appear in the UI is via the AC-RT-04 backfill.
    const otherCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      // `other` was created by seedTruncateAndCreate, so we log in rather
      // than re-register (register would return 409 EMAIL_TAKEN here).
      const session = await login(otherCtx, {
        email: other.email,
        password: other.password,
      });
      const headers = csrfHeaders(session);
      for (let i = 1; i <= 3; i += 1) {
        const r = await otherCtx.post(`/chats/${chatId}/messages`, {
          headers,
          data: { bodyText: `gap-${i.toString()}` },
        });
        expect(r.status()).toBe(200);
      }
    } finally {
      await otherCtx.dispose();
    }

    // Bring the SPA back online. The realtime client's reconnect loop
    // (250ms * 2^n, capped at 10s) should connect, re-subscribe, and fire
    // sync.request with lastKnownContiguousSequence=2. The server returns
    // fetch-history with rangeHint {fromSequence: 3, toSequence: 5}; the
    // ChatView backfill runs GET /chats/{id}/messages?afterSequence=2 and
    // merges the three missed rows into the cache.
    await context.setOffline(false);

    await expect(page.getByText('gap-1')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('gap-2')).toBeVisible();
    await expect(page.getByText('gap-3')).toBeVisible();
    // Two seed rows + three backfilled rows — AC-RT-05 (dedupe) is covered
    // because the client would otherwise double-render if the WS echo and
    // the HTTP backfill both landed.
    await expect(page.getByTestId('message')).toHaveCount(5);
  });
});
