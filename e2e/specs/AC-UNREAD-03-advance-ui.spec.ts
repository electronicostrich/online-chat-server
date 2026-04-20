import { expect, test } from '@playwright/test';
import {
  createRoomViaUi,
  newSeededUser,
  seedTruncateAndCreate,
  signInViaUi,
  withApiContext,
} from '../utils/ui-auth.js';

// AC-UNREAD-03 — UI surface: when a chat is opened, the SPA advances the
// caller's read state to the current head sequence via `POST /chats/{id}/read`.
// Subsequent sends by the caller re-advance the watermark so the server
// never reports unread for the caller's own traffic. The HTTP contract
// (monotonic advance, clamps over-advances, zero on empty chat) is
// independently covered by `e2e/specs/AC-UNREAD-03-explicit-advance.spec.ts`.
test.describe('AC-UNREAD-03: SPA advances read-state when opening and sending in a chat', () => {
  test('opening an empty chat leaves lastRead at 0 and sending advances the watermark', async ({
    page,
  }) => {
    const alice = newSeededUser('alice');
    await withApiContext(async (api) => {
      await seedTruncateAndCreate(api, [alice]);
    });

    await signInViaUi(page, alice);
    const chatId = await createRoomViaUi(page, `room-unread-${Date.now().toString(36)}`);

    // `page.context().request` is the same cookie jar Playwright used to
    // drive the UI sign-in, so calls through it are authenticated as Alice
    // and we can read her read-state server-side. The `request` fixture
    // doesn't share cookies with the browser context, so we deliberately
    // use the page context's request here.
    const api = page.context().request;

    // Wait for the mount-time advance to settle. Empty chat: advances to 0
    // (no-op on the server because head is 0) but the read-state record
    // still exists.
    await expect
      .poll(
        async () => {
          const res = await api.get(`http://localhost:3000/chats/${chatId}/read-state`);
          if (res.status() !== 200) return null;
          const body = (await res.json()) as {
            data: {
              chatId: string;
              lastReadSequence: number;
              headSequence: number;
              hasUnread: boolean;
            };
          };
          const { lastReadSequence, headSequence, hasUnread } = body.data;
          return { lastReadSequence, headSequence, hasUnread };
        },
        { timeout: 10_000 },
      )
      .toEqual({ lastReadSequence: 0, headSequence: 0, hasUnread: false });

    // Send three messages through the composer — the post-mutation advance
    // should carry the caller's watermark up to sequence 3.
    for (const line of ['one', 'two', 'three']) {
      await page.getByTestId('composer-input').fill(line);
      await page.getByTestId('composer-send').click();
      await page
        .getByTestId('message')
        .filter({ has: page.getByText(line, { exact: true }) })
        .waitFor({ state: 'visible' });
    }

    await expect
      .poll(
        async () => {
          const res = await api.get(`http://localhost:3000/chats/${chatId}/read-state`);
          if (res.status() !== 200) return null;
          const body = (await res.json()) as {
            data: {
              chatId: string;
              lastReadSequence: number;
              headSequence: number;
              hasUnread: boolean;
            };
          };
          const { lastReadSequence, headSequence, hasUnread } = body.data;
          return { lastReadSequence, headSequence, hasUnread };
        },
        { timeout: 10_000 },
      )
      .toEqual({ lastReadSequence: 3, headSequence: 3, hasUnread: false });
  });

  test('sending multiple messages keeps the watermark glued to head', async ({
    page,
  }) => {
    const alice = newSeededUser('alice');
    await withApiContext(async (api) => {
      await seedTruncateAndCreate(api, [alice]);
    });

    await signInViaUi(page, alice);
    const chatId = await createRoomViaUi(page, `room-unread2-${Date.now().toString(36)}`);

    const api = page.context().request;

    for (const line of ['hello', 'world']) {
      await page.getByTestId('composer-input').fill(line);
      await page.getByTestId('composer-send').click();
      await page
        .getByTestId('message')
        .filter({ has: page.getByText(line, { exact: true }) })
        .waitFor({ state: 'visible' });
    }

    // After both sends, the server watermark is at head=2 and the chat
    // reports no unread — the Composer's onSuccess advance keeps pace.
    await expect
      .poll(
        async () => {
          const res = await api.get(`http://localhost:3000/chats/${chatId}/read-state`);
          if (res.status() !== 200) return null;
          const body = (await res.json()) as {
            data: {
              chatId: string;
              lastReadSequence: number;
              headSequence: number;
              hasUnread: boolean;
            };
          };
          const { lastReadSequence, headSequence, hasUnread } = body.data;
          return { lastReadSequence, headSequence, hasUnread };
        },
        { timeout: 10_000 },
      )
      .toEqual({ lastReadSequence: 2, headSequence: 2, hasUnread: false });
  });
});
