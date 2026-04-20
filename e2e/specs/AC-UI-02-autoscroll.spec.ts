import { expect, test } from '@playwright/test';
import {
  createRoomViaUi,
  newSeededUser,
  seedTruncateAndCreate,
  signInViaUi,
  withApiContext,
} from '../utils/ui-auth.js';

// AC-UI-02 — when the user is at the bottom of the chat, a newly-arrived
// message must remain visible (the list auto-scrolls).
//
// The MessageList component treats every new message the same way regardless
// of source (own composer send vs websocket fan-out from another user) — the
// scroll-behaviour code path is identical. Driving the test through the
// composer keeps the assertion focused on the AC ("when a new message
// arrives, the chat auto-scrolls") without depending on the multi-user
// websocket fan-out path that lives in WS-05 + WS-08 specs.
test.describe('AC-UI-02: autoscroll occurs when user is at bottom', () => {
  test('newly-sent messages keep the bottom of the list in view', async ({
    page,
  }) => {
    const owner = newSeededUser('owner');
    await withApiContext(async (api) => {
      await seedTruncateAndCreate(api, [owner]);
    });

    await signInViaUi(page, owner);
    await createRoomViaUi(page, `lobby-${Date.now().toString(36)}`);

    const messageList = page.getByTestId('message-list');
    await expect(messageList).toBeVisible();

    const composerInput = page.getByTestId('composer-input');
    const composerSend = page.getByTestId('composer-send');

    // Pre-fill enough messages to make the list scrollable. Each send goes
    // through the API and back into the cache; the React Query mutation's
    // onSuccess is the same code path the websocket dispatcher uses.
    for (let i = 1; i <= 30; i += 1) {
      await composerInput.fill(`seed message ${i.toString()}`);
      await composerSend.click();
      await expect(composerInput).toHaveValue('');
    }

    await expect(page.getByTestId('message')).toHaveCount(30);

    // Confirm the user is at the bottom (autoscroll has been keeping pace).
    const distanceFromBottomBefore: number = await messageList.evaluate((el) => {
      const div = el as HTMLDivElement;
      return div.scrollHeight - div.clientHeight - div.scrollTop;
    });
    expect(distanceFromBottomBefore).toBeLessThanOrEqual(32);

    // The list MUST be tall enough that the autoscroll behaviour is non-
    // trivial — a list shorter than its container scrolls to bottom by
    // default (no overflow). If this assertion fails, increase the seed
    // count above so the list overflows the viewport.
    const overflows: boolean = await messageList.evaluate((el) => {
      const div = el as HTMLDivElement;
      return div.scrollHeight > div.clientHeight + 32;
    });
    expect(overflows).toBe(true);

    // Trigger the new message that the AC actually verifies.
    const arrivalMarker = `live-message-${Date.now().toString(36)}`;
    await composerInput.fill(arrivalMarker);
    await composerSend.click();
    await expect(composerInput).toHaveValue('');

    // The new message must be present AND the list must still be at the
    // bottom (i.e. the message is in the visible region).
    await expect(page.getByText(arrivalMarker)).toBeVisible();
    const distanceFromBottomAfter: number = await messageList.evaluate((el) => {
      const div = el as HTMLDivElement;
      return div.scrollHeight - div.clientHeight - div.scrollTop;
    });
    expect(distanceFromBottomAfter).toBeLessThanOrEqual(32);
  });
});
