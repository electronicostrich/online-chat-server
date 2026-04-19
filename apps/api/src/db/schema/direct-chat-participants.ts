import { pgTable, timestamp, uuid, primaryKey, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { chats } from './chats.js';
import { users } from './users.js';

// Maps to data-model.md §4.9. Exactly two rows per direct chat is
// enforced at write time (transaction logic), not by the schema.
export const directChatParticipants = pgTable(
  'direct_chat_participants',
  {
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
  },
  (t) => [
    primaryKey({ columns: [t.chatId, t.userId] }),
    index('direct_chat_participants_user_idx').on(t.userId, t.chatId),
  ],
);

export type DirectChatParticipantRow = typeof directChatParticipants.$inferSelect;
export type NewDirectChatParticipantRow = typeof directChatParticipants.$inferInsert;
