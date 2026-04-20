import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = { data: { room: { chatId: string } } };

type UploadResponse = {
  data: {
    attachment: {
      id: string;
      chatId: string;
      messageId: string;
      originalFilename: string;
      sizeBytes: number;
      mimeType: string | null;
      commentText: string | null;
      createdAt: string;
    };
    message: {
      id: string;
      chatId: string;
      sequence: number;
      authorUserId: string;
      kind: 'text' | 'system' | 'attachment';
      bodyText: string | null;
    };
  };
};

test.describe('AC-ATT-01: upload within limits', () => {
  test('room member uploads a small file with optional comment; metadata is stored', async () => {
    const suffix = uniqueSuffix();
    const alice = {
      email: `alice-${suffix}@example.com`,
      username: `alice_${suffix}`.replace(/-/g, '_'),
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
      const createRoom = await ctx.post('/rooms', {
        headers: csrfHeaders(session),
        data: { name: `room-${suffix}`, visibility: 'public' },
      });
      expect(createRoom.status()).toBe(200);
      const {
        data: { room },
      } = (await createRoom.json()) as CreateRoomResponse;

      const fileBody = Buffer.from('hello attachment\n');
      const upload = await ctx.post(`/chats/${room.chatId}/attachments`, {
        headers: csrfHeaders(session),
        multipart: {
          file: {
            name: 'spec-v3.pdf',
            mimeType: 'application/pdf',
            buffer: fileBody,
          },
          commentText: 'latest requirements',
        },
      });
      expect(upload.status()).toBe(200);
      const body = (await upload.json()) as UploadResponse;
      expect(body.data.attachment.chatId).toBe(room.chatId);
      expect(body.data.attachment.originalFilename).toBe('spec-v3.pdf');
      expect(body.data.attachment.sizeBytes).toBe(fileBody.byteLength);
      expect(body.data.attachment.mimeType).toBe('application/pdf');
      expect(body.data.attachment.commentText).toBe('latest requirements');
      // The sibling message row carries the sequence so WS-05 fan-out
      // works unchanged for attachments.
      expect(body.data.message.kind).toBe('attachment');
      expect(body.data.message.chatId).toBe(room.chatId);
      expect(body.data.message.sequence).toBe(1);
      expect(body.data.message.authorUserId).toBe(session.userId);

      // Upload must be visible in chat history as a `kind='attachment'`
      // row — proves the sibling message was committed.
      const history = await ctx.get(`/chats/${room.chatId}/messages`);
      expect(history.status()).toBe(200);
      const historyBody = (await history.json()) as {
        data: { messages: { id: string; kind: string }[] };
      };
      expect(historyBody.data.messages.some((m) => m.id === body.data.message.id)).toBe(true);
    } finally {
      await ctx.dispose();
    }
  });

  test('non-member cannot upload to a private room', async () => {
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

    const aliceCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const bobCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const aliceSession = await register(aliceCtx, alice);
      const bobSession = await register(bobCtx, bob);

      const createRoom = await aliceCtx.post('/rooms', {
        headers: csrfHeaders(aliceSession),
        data: { name: `private-${suffix}`, visibility: 'private' },
      });
      expect(createRoom.status()).toBe(200);
      const {
        data: { room },
      } = (await createRoom.json()) as CreateRoomResponse;

      const rejected = await bobCtx.post(`/chats/${room.chatId}/attachments`, {
        headers: csrfHeaders(bobSession),
        multipart: {
          file: { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('x') },
        },
      });
      expect(rejected.status()).toBe(403);
      const err = (await rejected.json()) as { error: { code: string } };
      expect(err.error.code).toBe('NOT_A_MEMBER');
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
    }
  });
});
