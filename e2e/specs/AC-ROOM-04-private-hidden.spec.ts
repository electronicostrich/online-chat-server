import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = { data: { room: { chatId: string } } };

type ListPublicRoomsResponse = {
  data: {
    rooms: Array<{ chatId: string; name: string }>;
    nextCursor: string | null;
  };
};

test.describe('AC-ROOM-04: private rooms are hidden from the catalog', () => {
  test('a non-member viewing the public catalog does not see private rooms, even via search', async () => {
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
      const res = await seed.post('/__test/seed', { data: { strategy: 'truncate' } });
      expect(res.status()).toBe(200);
    } finally {
      await seed.dispose();
    }

    const aliceCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const bobCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const aliceSession = await register(aliceCtx, alice);
      await register(bobCtx, bob);

      const privateName = `secrets-${suffix}`;
      const publicName = `open-${suffix}`;

      const privateRes = await aliceCtx.post('/rooms', {
        headers: csrfHeaders(aliceSession),
        data: { name: privateName, visibility: 'private' },
      });
      expect(privateRes.status()).toBe(200);
      const { data: { room: privateRoom } } =
        (await privateRes.json()) as CreateRoomResponse;

      const publicRes = await aliceCtx.post('/rooms', {
        headers: csrfHeaders(aliceSession),
        data: { name: publicName, visibility: 'public' },
      });
      expect(publicRes.status()).toBe(200);
      const { data: { room: publicRoom } } =
        (await publicRes.json()) as CreateRoomResponse;

      // Default catalog view: the public room is visible; the private
      // one is not.
      const listRes = await bobCtx.get('/rooms/public');
      expect(listRes.status()).toBe(200);
      const list = (await listRes.json()) as ListPublicRoomsResponse;
      const ids = list.data.rooms.map((r) => r.chatId);
      expect(ids).toContain(publicRoom.chatId);
      expect(ids).not.toContain(privateRoom.chatId);

      // Even a highly-specific search query cannot surface the private
      // room — name-based probing must not leak existence.
      const searchRes = await bobCtx.get(`/rooms/public?q=${privateName}`);
      expect(searchRes.status()).toBe(200);
      const search = (await searchRes.json()) as ListPublicRoomsResponse;
      const searchIds = search.data.rooms.map((r) => r.chatId);
      expect(searchIds).not.toContain(privateRoom.chatId);
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
    }
  });
});
