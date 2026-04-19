import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = {
  data: {
    room: {
      chatId: string;
      name: string;
      description: string | null;
      visibility: 'public' | 'private';
      ownerUserId: string;
      createdAt: string;
    };
  };
};

type ErrorResponse = {
  error: { code: string; message: string };
};

test.describe('AC-ROOM-01: authenticated user creates a room', () => {
  test('creates the room, makes the caller owner, rejects duplicate names', async () => {
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
        data: { strategy: 'truncate' },
      });
      expect(res.status()).toBe(200);
    } finally {
      await seed.dispose();
    }

    const ctx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const session = await register(ctx, alice);

      const roomName = `room-${suffix}`;
      const create = await ctx.post('/rooms', {
        headers: csrfHeaders(session),
        data: {
          name: roomName,
          description: 'the first room',
          visibility: 'public',
        },
      });
      expect(create.status()).toBe(200);

      const body = (await create.json()) as CreateRoomResponse;
      expect(body.data.room.name).toBe(roomName);
      expect(body.data.room.visibility).toBe('public');
      expect(body.data.room.description).toBe('the first room');
      expect(body.data.room.ownerUserId).toBe(session.userId);
      expect(body.data.room.chatId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      // AC-ROOM-02: duplicate normalized name is rejected with CONFLICT
      // even for a different user attempting to re-register the name.
      const bobCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
      try {
        const bobSession = await register(bobCtx, bob);
        const dup = await bobCtx.post('/rooms', {
          headers: csrfHeaders(bobSession),
          data: {
            // Uppercase + extra whitespace still collides via normalization.
            name: `  ROOM-${suffix.toUpperCase()}  `,
            visibility: 'private',
          },
        });
        expect(dup.status()).toBe(409);
        const dupBody = (await dup.json()) as ErrorResponse;
        expect(dupBody.error.code).toBe('CONFLICT');
      } finally {
        await bobCtx.dispose();
      }
    } finally {
      await ctx.dispose();
    }
  });

  test('rejects unauthenticated room creation', async () => {
    const ctx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const res = await ctx.post('/rooms', {
        data: { name: 'anon-room', visibility: 'public' },
      });
      // CSRF gate fires before session check when no cookies are set, so
      // the response is 403 rather than 401. Either is acceptable per the
      // AC ("not signed in → rejected"), so assert the 4xx plus the
      // known error codes.
      expect([401, 403]).toContain(res.status());
      const body = (await res.json()) as ErrorResponse;
      expect(['UNAUTHENTICATED', 'CSRF_FAILED']).toContain(body.error.code);
    } finally {
      await ctx.dispose();
    }
  });
});
