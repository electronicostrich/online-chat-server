import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type MessageShape = {
  id: string;
  sequence: number;
  authorUserId: string;
  bodyText: string | null;
  editedAt: string | null;
};

test.describe('AC-MSG-04: author edits own message', () => {
  test('author edit sets editedAt; non-author edit is FORBIDDEN', async () => {
    const suffix = uniqueSuffix();
    const alice = {
      email: `alice-${suffix}@example.com`,
      username: `alice_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const bob = {
      email: `bob-${suffix}@example.com`,
      username: `bob_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };

    const seed = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const res = await seed.post('/__test/seed', {
        data: {
          strategy: 'truncate',
          users: [alice, bob],
          // Join Bob to Alice's about-to-be-created room so that
          // non-author edits are truly tested against the same room.
        },
      });
      expect(res.status()).toBe(200);
    } finally {
      await seed.dispose();
    }

    const aliceCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const bobCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const aliceSession = await register(aliceCtx, alice);
      const bobSession = await register(bobCtx, bob);

      const createRoom = await aliceCtx.post('/rooms', {
        headers: csrfHeaders(aliceSession),
        data: { name: `room-${suffix}`, visibility: 'public' },
      });
      expect(createRoom.status()).toBe(200);
      const {
        data: { room },
      } = (await createRoom.json()) as {
        data: { room: { chatId: string } };
      };

      // Put Bob in the room so that the author-check (not the
      // membership gate) is the thing that rejects his edit. Without
      // this, the non-author 403 could be masked by a NOT_A_MEMBER 403
      // and the test wouldn't actually exercise AC-MSG-04.
      const appendSeed = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
      try {
        const res = await appendSeed.post('/__test/seed', {
          data: {
            strategy: 'append',
            roomMembershipsByChatId: [
              { chatId: room.chatId, username: bob.username, role: 'member' },
            ],
          },
        });
        expect(res.status()).toBe(200);
      } finally {
        await appendSeed.dispose();
      }

      const send = await aliceCtx.post(`/chats/${room.chatId}/messages`, {
        headers: csrfHeaders(aliceSession),
        data: { bodyText: 'original' },
      });
      expect(send.status()).toBe(200);
      const sent = (await send.json()) as { data: { message: MessageShape } };
      const messageId = sent.data.message.id;
      expect(sent.data.message.editedAt).toBeNull();

      const edit = await aliceCtx.patch(`/messages/${messageId}`, {
        headers: csrfHeaders(aliceSession),
        data: { bodyText: 'edited!' },
      });
      expect(edit.status()).toBe(200);
      const edited = (await edit.json()) as { data: { message: MessageShape } };
      expect(edited.data.message.bodyText).toBe('edited!');
      expect(edited.data.message.editedAt).not.toBeNull();

      // Non-author (Bob) is in the room but not the message author, so
      // the edit is rejected because he isn't the author — the AC.
      const bobEdit = await bobCtx.patch(`/messages/${messageId}`, {
        headers: csrfHeaders(bobSession),
        data: { bodyText: 'hostile edit' },
      });
      expect(bobEdit.status()).toBe(403);
      const bobErr = (await bobEdit.json()) as { error: { code: string } };
      expect(bobErr.error.code).toBe('FORBIDDEN');

      // Subsequent author edit re-runs the editedAt timestamp without
      // changing message identity — the AC.
      const reedit = await aliceCtx.patch(`/messages/${messageId}`, {
        headers: csrfHeaders(aliceSession),
        data: { bodyText: 'edited again' },
      });
      expect(reedit.status()).toBe(200);
      const re = (await reedit.json()) as { data: { message: MessageShape } };
      expect(re.data.message.id).toBe(messageId);
      expect(re.data.message.bodyText).toBe('edited again');
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
    }
  });
});
