import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type ListPublicRoomsResponse = {
  data: {
    rooms: Array<{
      chatId: string;
      name: string;
      description: string | null;
      memberCount: number;
      createdAt: string;
    }>;
    nextCursor: string | null;
  };
};

test.describe('AC-ROOM-03: public room catalog', () => {
  test('lists public rooms with member count and supports name search', async () => {
    const suffix = uniqueSuffix();
    const alice = {
      email: `alice-${suffix}@example.com`,
      username: `alice_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };

    const seed = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const res = await seed.post('/__test/seed', { data: { strategy: 'truncate' } });
      expect(res.status()).toBe(200);
    } finally {
      await seed.dispose();
    }

    const ctx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const session = await register(ctx, alice);
      const hdrs = csrfHeaders(session);

      // Create three rooms: two public (one distinctive), one private.
      const names = [
        `general-${suffix}`,
        `engineering-${suffix}`,
        `secret-${suffix}`,
      ];
      for (const [i, name] of names.entries()) {
        const r = await ctx.post('/rooms', {
          headers: hdrs,
          data: { name, visibility: i === 2 ? 'private' : 'public' },
        });
        expect(r.status()).toBe(200);
      }

      // Default list shows both public rooms, not the private one.
      const listRes = await ctx.get('/rooms/public');
      expect(listRes.status()).toBe(200);
      const list = (await listRes.json()) as ListPublicRoomsResponse;
      const listed = list.data.rooms.map((r) => r.name);
      expect(listed).toContain(`general-${suffix}`);
      expect(listed).toContain(`engineering-${suffix}`);
      expect(listed).not.toContain(`secret-${suffix}`);

      // Each entry includes memberCount. Owner is always a member so
      // every new room has at least 1.
      for (const entry of list.data.rooms) {
        expect(entry.memberCount).toBeGreaterThanOrEqual(1);
      }

      // Search narrows the list to matching rooms (case-insensitive
      // substring on name).
      const searchRes = await ctx.get('/rooms/public?q=ENGINEER');
      expect(searchRes.status()).toBe(200);
      const search = (await searchRes.json()) as ListPublicRoomsResponse;
      const searchNames = search.data.rooms.map((r) => r.name);
      expect(searchNames).toContain(`engineering-${suffix}`);
      expect(searchNames).not.toContain(`general-${suffix}`);
    } finally {
      await ctx.dispose();
    }
  });

  test('requires authentication', async () => {
    const ctx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const res = await ctx.get('/rooms/public');
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });
});

