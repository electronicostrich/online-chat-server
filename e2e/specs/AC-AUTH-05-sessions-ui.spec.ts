import { expect, test } from '@playwright/test';
import { login } from '../utils/auth.js';
import {
  newSeededUser,
  seedTruncateAndCreate,
  signInViaUi,
  withApiContext,
} from '../utils/ui-auth.js';

// AC-AUTH-05 — UI surface: the sessions screen renders every active session
// the signed-in user owns with user-agent + IP metadata, and marks exactly
// one session as current. The "cannot view sessions belonging to another
// user" clause is covered by the backend contract and its spec at
// `AC-AUTH-05-sessions-list.spec.ts` (the API never returns another user's
// rows; the UI simply paints what it receives).
//
// AC-AUTH-06 — UI surface: revoking a non-current session removes it from
// the list without ending the caller's own session. The websocket-drop side
// of AC-AUTH-06 is backend-owned and covered by
// `AC-AUTH-06-ws-drop.spec.ts`.
test.describe('AC-AUTH-05 / AC-AUTH-06: sessions screen renders and revokes sessions', () => {
  test('lists each active session with metadata and exactly one marked current', async ({
    page,
  }) => {
    const alice = newSeededUser('alice');
    await withApiContext(async (api) => {
      await seedTruncateAndCreate(api, [alice]);
    });

    // Create a second active session for Alice from a headless API context so
    // the UI-rendered list has more than one row to assert against.
    const secondaryLogin = await withApiContext(async (api) =>
      login(api, { email: alice.email, password: alice.password }),
    );

    await signInViaUi(page, alice);

    await page.getByTestId('nav-sessions').click();
    const screen = page.getByTestId('sessions-screen');
    await expect(screen).toBeVisible();

    const rows = screen.getByTestId('sessions-list-item');
    await expect(rows).toHaveCount(2);

    const currentBadges = screen.getByTestId('sessions-current-badge');
    await expect(currentBadges).toHaveCount(1);

    // Every row renders a non-empty user-agent and IP string, per AC-AUTH-05.
    const count = await rows.count();
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i);
      const ua = (await row.getByTestId('session-user-agent').textContent()) ?? '';
      const ip = (await row.getByTestId('session-ip-address').textContent()) ?? '';
      expect(ua.trim().length).toBeGreaterThan(0);
      expect(ip.trim().length).toBeGreaterThan(0);
    }

    // The API-created secondary session must appear in the rendered list and
    // must NOT be the current row (the current row is the browser's own).
    const secondaryRow = rows.filter({
      has: page.locator(`[data-session-id="${secondaryLogin.sessionId}"]`),
    });
    await expect(secondaryRow).toHaveCount(1);
    await expect(
      secondaryRow.getByTestId('sessions-current-badge'),
    ).toHaveCount(0);
  });

  test('revoking a non-current session removes it and leaves the caller signed in', async ({
    page,
  }) => {
    const alice = newSeededUser('alice');
    await withApiContext(async (api) => {
      await seedTruncateAndCreate(api, [alice]);
    });

    const secondaryLogin = await withApiContext(async (api) =>
      login(api, { email: alice.email, password: alice.password }),
    );

    await signInViaUi(page, alice);
    await page.getByTestId('nav-sessions').click();
    await page.getByTestId('sessions-screen').waitFor({ state: 'visible' });

    const targetRow = page
      .getByTestId('sessions-list-item')
      .filter({ has: page.locator(`[data-session-id="${secondaryLogin.sessionId}"]`) });
    await expect(targetRow).toHaveCount(1);

    await targetRow.getByTestId('sessions-revoke').click();
    await expect(targetRow).toHaveCount(0);

    // Exactly one session remains, and it's the current one.
    await expect(page.getByTestId('sessions-list-item')).toHaveCount(1);
    await expect(page.getByTestId('sessions-current-badge')).toHaveCount(1);

    // The caller remains signed in: clicking "Back to chat" shows the shell
    // instead of bouncing them to the login screen.
    await page.getByTestId('sessions-back').click();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId('empty-chat')).toBeVisible();
  });
});
