import { pgTable, timestamp, uuid, bigint, primaryKey, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { chats } from './chats.js';
import { users } from './users.js';

// Maps to data-model.md §4.16. One row per `(chat_id, user_id)` pair.
// Absence of a row means "never opened"; the AC-UNREAD-01/02 query must
// LEFT JOIN and treat the missing row as last_read_sequence=0.
export const chatReadState = pgTable(
  'chat_read_state',
  {
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastReadSequence: bigint('last_read_sequence', { mode: 'number' }).notNull().default(0),
    lastOpenedAt: timestamp('last_opened_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
  },
  (t) => [
    primaryKey({ columns: [t.chatId, t.userId] }),
    check('chat_read_state_last_read_nonneg', sql`${t.lastReadSequence} >= 0`),
    index('chat_read_state_user_idx').on(t.userId, sql`updated_at DESC`),
  ],
);

export type ChatReadStateRow = typeof chatReadState.$inferSelect;
export type NewChatReadStateRow = typeof chatReadState.$inferInsert;
