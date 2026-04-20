import { expect, test } from '@playwright/test';
import {
  createRoomViaUi,
  newSeededUser,
  seedTruncateAndCreate,
  signInViaUi,
  withApiContext,
} from '../utils/ui-auth.js';

// AC-MSG-04 — UI surface: the author of a message can trigger an inline edit
// from the message-list and the rendered body + edited indicator update on
// success. The HTTP contract (PATCH /messages/{id} requires authorship,
// non-author edits are FORBIDDEN, edited_at is set) is independently covered
// by `e2e/specs/AC-MSG-04-edit-own.spec.ts`. This spec drives the same
// behaviour through the React SPA so the UI surface is verified end-to-end.
test.describe('AC-MSG-04: author edits own message via the UI', () => {
  test('inline edit updates rendered body and reveals the edited indicator', async ({
    page,
  }) => {
    const alice = newSeededUser('alice');
    await withApiContext(async (api) => {
      await seedTruncateAndCreate(api, [alice]);
    });

    await signInViaUi(page, alice);
    await createRoomViaUi(page, `room-edit-${Date.now().toString(36)}`);

    await page.getByTestId('composer-input').fill('first draft');
    await page.getByTestId('composer-send').click();

    // Pin a stable handle to the row via `data-message-id` so later
    // assertions don't get invalidated when the body text changes under a
    // `filter({ has: page.getByText(...) })` clause.
    const firstDraft = page
      .getByTestId('message')
      .filter({ has: page.getByText('first draft', { exact: true }) });
    await firstDraft.waitFor({ state: 'visible' });
    const messageId = await firstDraft.getAttribute('data-message-id');
    if (messageId === null) throw new Error('message row missing data-message-id');
    const message = page.locator(`[data-testid="message"][data-message-id="${messageId}"]`);
    await expect(message.getByTestId('message-edited')).toHaveCount(0);

    await message.getByTestId('message-edit').click();
    const editor = message.getByTestId('message-edit-input');
    await editor.waitFor({ state: 'visible' });
    await editor.fill('second draft');
    await message.getByTestId('message-edit-save').click();

    // Body re-renders to the new text and the "(edited)" indicator appears.
    await expect(message.getByTestId('message-body')).toHaveText('second draft');
    await expect(message.getByTestId('message-edited')).toHaveCount(1);

    // The editor closes after a successful save so the next interaction
    // starts from the read-only body, not from a half-open editor.
    await expect(editor).toHaveCount(0);
  });

  test('cancel discards local edits and restores the original body', async ({
    page,
  }) => {
    const alice = newSeededUser('alice');
    await withApiContext(async (api) => {
      await seedTruncateAndCreate(api, [alice]);
    });

    await signInViaUi(page, alice);
    await createRoomViaUi(page, `room-edit-cancel-${Date.now().toString(36)}`);

    await page.getByTestId('composer-input').fill('keep me');
    await page.getByTestId('composer-send').click();

    const row = page
      .getByTestId('message')
      .filter({ has: page.getByText('keep me', { exact: true }) });
    await row.waitFor({ state: 'visible' });
    const messageId = await row.getAttribute('data-message-id');
    if (messageId === null) throw new Error('message row missing data-message-id');
    const message = page.locator(`[data-testid="message"][data-message-id="${messageId}"]`);

    await message.getByTestId('message-edit').click();
    const editor = message.getByTestId('message-edit-input');
    await editor.fill('overwrite');
    await message.getByTestId('message-edit-cancel').click();

    await expect(editor).toHaveCount(0);
    await expect(message.getByTestId('message-body')).toHaveText('keep me');
    await expect(message.getByTestId('message-edited')).toHaveCount(0);
  });

  // A third negative case — "non-author sees no Edit button on someone
  // else's message" — would require either a list-my-rooms endpoint (so a
  // second user can mount the room) or a second seeded message to land in
  // Alice's view (the test-seed endpoint doesn't support inserting
  // messages, and the websocket fan-out through the Vite dev-server proxy
  // is unreliable for headless Chromium cookie upgrades per the WS-07
  // backbone progress note). The server-side author-check is already
  // covered by `AC-MSG-04-edit-own.spec.ts`, and the client-side logic is
  // a single prop check (`authorUserId === currentUserId`) — deferring
  // end-to-end coverage until the list-my-rooms surface lands is
  // acceptable per the WS-07 progress notes.
});
