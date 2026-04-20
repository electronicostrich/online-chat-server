import { expect, test } from '@playwright/test';
import {
  createRoomViaUi,
  newSeededUser,
  seedTruncateAndCreate,
  signInViaUi,
  withApiContext,
} from '../utils/ui-auth.js';

// AC-UI-03 — when the user has scrolled up to read older history, new
// messages MUST NOT forcibly jump the view to the bottom. The MessageList
// instead surfaces an "↓ N new" pill that the user can click to opt in.
//
// As with AC-UI-02 above, the new-message arrival is driven through the
// composer because the MessageList code path is the same regardless of the
// source of the new message (own send vs websocket fan-out from another
// user). Multi-user fan-out scenarios live in WS-05 + WS-08 specs.
test.describe('AC-UI-03: no forced autoscroll while reading older history', () => {
  test('scrolled-up viewport stays put when a new message lands; pill is offered', async ({
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

    for (let i = 1; i <= 40; i += 1) {
      await composerInput.fill(`seed message ${i.toString()}`);
      await composerSend.click();
      await expect(composerInput).toHaveValue('');
    }
    await expect(page.getByTestId('message')).toHaveCount(40);

    // Sanity: the message list must overflow its container so scrolling up
    // is meaningful.
    const overflows: boolean = await messageList.evaluate((el) => {
      const div = el as HTMLDivElement;
      return div.scrollHeight > div.clientHeight + 32;
    });
    expect(overflows).toBe(true);

    // Scroll the user to the very top — they're emphatically NOT at bottom.
    await messageList.evaluate((el) => {
      (el as HTMLDivElement).scrollTop = 0;
    });
    // The scroll listener mirrors the at-bottom bit onto a DOM attribute;
    // wait for it instead of sleeping a fixed duration so the spec is not
    // flake-prone under slow CI runners.
    await expect(messageList).toHaveAttribute('data-at-bottom', 'false');
    const scrollTopBefore: number = await messageList.evaluate(
      (el) => (el as HTMLDivElement).scrollTop,
    );
    expect(scrollTopBefore).toBe(0);

    // Send a new message via the composer.
    const arrivalMarker = `incoming-${Date.now().toString(36)}`;
    await composerInput.fill(arrivalMarker);
    await composerSend.click();
    await expect(composerInput).toHaveValue('');

    // The message DOES land in the DOM (appended at the bottom).
    await expect(page.getByText(arrivalMarker)).toHaveCount(1);

    // The view MUST NOT have been forced to the bottom — scrollTop should
    // still be at (or very near) the top where we left it.
    const scrollTopAfter: number = await messageList.evaluate(
      (el) => (el as HTMLDivElement).scrollTop,
    );
    expect(scrollTopAfter).toBeLessThanOrEqual(8);

    // The opt-in "↓ N new" pill is visible.
    const pill = page.getByTestId('unread-pill');
    await expect(pill).toBeVisible();

    // Clicking it jumps to the bottom AND clears the pill.
    await pill.click();
    await expect(pill).toBeHidden();
    const distanceFromBottomAfterJump: number = await messageList.evaluate(
      (el) => {
        const div = el as HTMLDivElement;
        return div.scrollHeight - div.clientHeight - div.scrollTop;
      },
    );
    expect(distanceFromBottomAfterJump).toBeLessThanOrEqual(32);
  });
});
