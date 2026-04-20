import { expect, test } from '@playwright/test';
import {
  createRoomViaUi,
  newSeededUser,
  seedTruncateAndCreate,
  signInViaUi,
  withApiContext,
} from '../utils/ui-auth.js';

// AC-UI-01 — "they see a top menu, central message area, bottom composer,
// side navigation for rooms/contacts, and a right-side context/members panel
// when applicable." The right panel is conditional on a chat being open.
test.describe('AC-UI-01: standard chat layout is preserved', () => {
  test('signed-in user sees top menu, side nav, message area, and composer', async ({
    page,
  }) => {
    const owner = newSeededUser('owner');
    await withApiContext(async (api) => {
      await seedTruncateAndCreate(api, [owner]);
    });

    await signInViaUi(page, owner);

    // Top menu (banner) is always present after sign-in.
    const topMenu = page.getByTestId('top-menu');
    await expect(topMenu).toBeVisible();
    await expect(topMenu).toHaveAttribute('role', 'banner');
    await expect(topMenu.getByTestId('sign-out')).toBeVisible();

    // Side navigation is always present and lists rooms (empty initially).
    const sideNav = page.getByTestId('side-nav');
    await expect(sideNav).toBeVisible();
    await expect(sideNav).toHaveAttribute('aria-label', 'Rooms and contacts');
    await expect(sideNav.getByTestId('room-list')).toBeVisible();

    // Central message area is always present; before a chat is selected, it
    // shows the empty-chat placeholder.
    const messageArea = page.getByTestId('message-area');
    await expect(messageArea).toBeVisible();
    await expect(messageArea.getByTestId('empty-chat')).toBeVisible();

    // The right-side context panel is *not* shown when no chat is open
    // (per AC-UI-01: "when applicable").
    await expect(page.getByTestId('right-panel')).toHaveCount(0);
  });

  test('opening a room reveals composer and right-side context panel', async ({
    page,
  }) => {
    const owner = newSeededUser('owner');
    await withApiContext(async (api) => {
      await seedTruncateAndCreate(api, [owner]);
    });

    await signInViaUi(page, owner);

    const chatId = await createRoomViaUi(page, `lobby-${Date.now().toString(36)}`);
    expect(chatId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );

    // Bottom composer is the third required region from AC-UI-01.
    const composer = page.getByTestId('composer');
    await expect(composer).toBeVisible();
    await expect(composer.getByTestId('composer-input')).toBeVisible();
    await expect(composer.getByTestId('composer-send')).toBeDisabled();

    // Right-side context panel is shown once a chat is selected.
    const rightPanel = page.getByTestId('right-panel');
    await expect(rightPanel).toBeVisible();
    await expect(rightPanel).toHaveAttribute('aria-label', 'Chat context');
  });
});
