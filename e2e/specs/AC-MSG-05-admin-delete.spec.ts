import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type MessageShape = {
  id: string;
  bodyText: string | null;
  deletedAt: string | null;
};

test.describe("AC-MSG-05: admin deletes another user's room message", () => {
  test('admin delete of member message succeeds; plain member is FORBIDDEN', async () => {
    const suffix = uniqueSuffix();
    const owner = {
      email: `owner-${suffix}@example.com`,
      username: `owner_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const adminUser = {
      email: `admin-${suffix}@example.com`,
      username: `admin_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const memberUser = {
      email: `member-${suffix}@example.com`,
      username: `member_${suffix}`.replace(/-/g, '_'),
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

    const ownerCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const adminCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const memberCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const ownerSession = await register(ownerCtx, owner);
      const adminSession = await register(adminCtx, adminUser);
      const memberSession = await register(memberCtx, memberUser);

      const createRoom = await ownerCtx.post('/rooms', {
        headers: csrfHeaders(ownerSession),
        data: { name: `mod-${suffix}`, visibility: 'public' },
      });
      expect(createRoom.status()).toBe(200);
      const {
        data: { room },
      } = (await createRoom.json()) as {
        data: { room: { chatId: string } };
      };

      // Append-seed the room memberships for admin + member. WS-03
      // hasn't landed join/promote endpoints; the test-only seed is the
      // documented way to set up multi-role fixtures until it does.
      const appendSeed = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
      try {
        const res = await appendSeed.post('/__test/seed', {
          data: {
            strategy: 'append',
            roomMembershipsByChatId: [
              { chatId: room.chatId, username: adminUser.username, role: 'admin' },
              { chatId: room.chatId, username: memberUser.username, role: 'member' },
            ],
          },
        });
        expect(res.status()).toBe(200);
      } finally {
        await appendSeed.dispose();
      }

      // Member sends a message, admin deletes it.
      const sent = await memberCtx.post(`/chats/${room.chatId}/messages`, {
        headers: csrfHeaders(memberSession),
        data: { bodyText: 'please delete me' },
      });
      expect(sent.status()).toBe(200);
      const sentBody = (await sent.json()) as { data: { message: MessageShape } };
      const messageId = sentBody.data.message.id;

      const del = await adminCtx.delete(`/messages/${messageId}`, {
        headers: csrfHeaders(adminSession),
      });
      expect(del.status()).toBe(200);

      const history = await memberCtx.get(`/chats/${room.chatId}/messages`);
      expect(history.status()).toBe(200);
      const hist = (await history.json()) as {
        data: { messages: MessageShape[] };
      };
      const hiddenRow = hist.data.messages.find((m) => m.id === messageId);
      expect(hiddenRow).toBeDefined();
      if (hiddenRow !== undefined) {
        expect(hiddenRow.deletedAt).not.toBeNull();
        // Deleted messages still appear in history with body_text nulled
        // out (content hidden, row kept so sequence order is preserved).
        expect(hiddenRow.bodyText).toBeNull();
      }

      // Second message, sent by admin, that a plain member tries to
      // delete. Expect FORBIDDEN — member has no moderation rights.
      const adminSend = await adminCtx.post(`/chats/${room.chatId}/messages`, {
        headers: csrfHeaders(adminSession),
        data: { bodyText: "admin's own words" },
      });
      expect(adminSend.status()).toBe(200);
      const adminSent = (await adminSend.json()) as {
        data: { message: MessageShape };
      };
      const memberDel = await memberCtx.delete(`/messages/${adminSent.data.message.id}`, {
        headers: csrfHeaders(memberSession),
      });
      expect(memberDel.status()).toBe(403);
      const memberErr = (await memberDel.json()) as { error: { code: string } };
      expect(memberErr.error.code).toBe('FORBIDDEN');
    } finally {
      await ownerCtx.dispose();
      await adminCtx.dispose();
      await memberCtx.dispose();
    }
  });
});
