import { expect, test } from '@playwright/test';
import {
  createRoomViaUi,
  newSeededUser,
  seedTruncateAndCreate,
  signInViaUi,
  withApiContext,
} from '../utils/ui-auth.js';

// AC-ATT-01 — UI surface: a room participant can trigger an upload through
// the composer's attach control, the resulting attachment message renders
// with the original filename + size, and the download link serves the same
// bytes with a `Content-Disposition: attachment` header that echoes the
// original filename (AC-ATTACH-06 UI half).
//
// The HTTP contract (multipart parsing, size caps, metadata persistence,
// sibling `kind='attachment'` message, CSRF enforcement) is independently
// covered by `e2e/specs/AC-ATT-01-upload.spec.ts`. This spec drives the
// same happy-path through the React SPA so the UI surface is verified
// end-to-end.
test.describe('AC-ATT-01: room participant uploads via the UI', () => {
  test('composer attach sends a file; attachment card + download link appear', async ({
    page,
  }) => {
    const alice = newSeededUser('alice');
    await withApiContext(async (api) => {
      await seedTruncateAndCreate(api, [alice]);
    });

    await signInViaUi(page, alice);
    await createRoomViaUi(page, `room-upload-${Date.now().toString(36)}`);

    const fileName = 'hello.txt';
    const fileBody = 'Hello from the UI upload spec.';
    // Optional comment travels through the composer's textarea per
    // AC-ATT-01 "optional comment is stored if provided".
    await page.getByTestId('composer-input').fill('see attached');

    await page.getByTestId('composer-file-input').setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(fileBody, 'utf-8'),
    });

    // The new attachment row appears as a `kind='attachment'` message with a
    // filename label and a download affordance. Wait on the filename
    // specifically so the assertion doesn't race the send mutation.
    const attachmentMessage = page
      .getByTestId('message')
      .filter({ has: page.getByTestId('attachment-card') });
    await attachmentMessage.waitFor({ state: 'visible' });

    await expect(attachmentMessage).toHaveAttribute('data-kind', 'attachment');
    await expect(attachmentMessage.getByTestId('attachment-filename')).toHaveText(
      fileName,
    );
    // 30-byte body → the helper prints "30 B" (< 1 KiB threshold).
    await expect(attachmentMessage.getByTestId('attachment-size')).toContainText(
      'B',
    );
    await expect(attachmentMessage.getByTestId('attachment-comment')).toHaveText(
      'see attached',
    );

    // After a successful upload the composer's draft clears so the user
    // can start typing again without deleting the comment-turned-caption.
    await expect(page.getByTestId('composer-input')).toHaveValue('');

    // Verify the download link actually points at the authenticated
    // `/attachments/{id}/download` endpoint and serves the exact bytes. We
    // reuse the page's cookies by issuing the request through the same
    // browser context's request helper.
    const downloadLink = attachmentMessage.getByTestId('attachment-download');
    const href = await downloadLink.getAttribute('href');
    if (href === null) throw new Error('attachment download link missing href');
    expect(href).toMatch(/\/attachments\/[0-9a-f-]+\/download$/u);

    const response = await page.request.get(href);
    expect(response.status()).toBe(200);
    // RFC 6266 §4.3: the server emits both a legacy `filename="..."` and a
    // `filename*=UTF-8''...` form. Assert on the legacy form since the
    // test filename is ASCII-safe and both forms must carry it.
    const disposition = response.headers()['content-disposition'] ?? '';
    expect(disposition).toContain(`filename="${fileName}"`);
    expect(await response.text()).toBe(fileBody);
  });
});
