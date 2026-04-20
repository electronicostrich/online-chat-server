import { expect, test } from '@playwright/test';
import {
  createRoomViaUi,
  newSeededUser,
  seedTruncateAndCreate,
  signInViaUi,
  withApiContext,
} from '../utils/ui-auth.js';

// The browser-context request is an absolute-URL jar (`page.context().request`
// isn't routed through Playwright's `use.baseURL` default), so we need a
// full URL. Read it from the env so CI / staging runs can override.
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

// AC-UNREAD-03 — UI surface: when a chat is opened, the SPA advances the
// caller's read state to the current head sequence via `POST /chats/{id}/read`.
// Subsequent sends by the caller re-advance the watermark so the server
// never reports unread for the caller's own traffic. The HTTP contract
// (monotonic advance, clamps over-advances, zero on empty chat) is
// independently covered by `e2e/specs/AC-UNREAD-03-explicit-advance.spec.ts`.
//
// The two polling blocks below are intentionally inlined rather than
// extracted to a shared helper — `playwright/expect-expect` only counts
// assertions that live directly in the test body, and listing a
// spec-specific helper name in the global eslint config would leak spec
// internals into shared config. The duplication is ~18 lines across two
// tests, which is within the "three usages before extracting" rule in
// `docs/ai-development-guardrails.md` §5.2.
test.describe('AC-UNREAD-03: SPA advances read-state when opening and sending in a chat', () => {
  test('opening a chat fires POST /chats/{id}/read and sending advances the watermark', async ({
    page,
  }) => {
    const alice = newSeededUser('alice');
    await withApiContext(async (api) => {
      await seedTruncateAndCreate(api, [alice]);
    });

    await signInViaUi(page, alice);

    // Observe the mount-time `POST /chats/{id}/read`. The `waitForRequest`
    // promise is set up before the chat is opened so the POST the
    // `ChatView` effect issues on its initial fetch can be captured. An
    // empty-chat + `lastReadSequence=0` steady state is indistinguishable
    // from "advance never fired", so the only way to assert the
    // clear-on-open path without a messages-seed endpoint is to observe
    // the network request itself.
    const readRequestPromise = page.waitForRequest((req) =>
      req.method() === 'POST' && /\/chats\/[^/]+\/read$/.test(req.url()),
    );
    const chatId = await createRoomViaUi(page, `room-unread-${Date.now().toString(36)}`);
    const readReq = await readRequestPromise;
    expect(readReq.url()).toContain(`/chats/${chatId}/read`);
    expect(JSON.parse(readReq.postData() ?? '{}')).toEqual({ readUpToSequence: 0 });

    // `page.context().request` is the same cookie jar Playwright used to
    // drive the UI sign-in, so calls through it are authenticated as
    // Alice and we can read her read-state server-side. The `request`
    // fixture doesn't share cookies with the browser context, so we
    // deliberately use the page context's request here.
    const api = page.context().request;

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
          const res = await api.get(`${API_BASE_URL}/chats/${chatId}/read-state`);
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
          const res = await api.get(`${API_BASE_URL}/chats/${chatId}/read-state`);
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
