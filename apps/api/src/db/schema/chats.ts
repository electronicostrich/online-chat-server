import { pgTable, text, timestamp, uuid, bigint, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Maps to data-model.md §4.7. Top-level chat container shared by rooms
// (`type='room'`) and direct chats (`type='direct'`). `current_sequence`
// holds the latest assigned message sequence for this chat (see WS-04).
export const chats = pgTable(
  'chats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type', { enum: ['room', 'direct'] }).notNull(),
    currentSequence: bigint('current_sequence', { mode: 'number' })
      .notNull()
      .default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('chats_type_deleted_idx').on(t.type, t.deletedAt)],
);

export type ChatRow = typeof chats.$inferSelect;
export type NewChatRow = typeof chats.$inferInsert;
