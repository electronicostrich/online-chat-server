import { pgTable, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';

// Maps to data-model.md §4.5. Symmetric friendships are stored as an
// ordered pair (user_low_id < user_high_id) so the unique-active index
// can guard against duplicates without a separate two-row representation.
export const friendships = pgTable(
  'friendships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userLowId: uuid('user_low_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userHighId: uuid('user_high_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    index('friendships_user_low_idx').on(t.userLowId, t.endedAt),
    index('friendships_user_high_idx').on(t.userHighId, t.endedAt),
  ],
);

export type FriendshipRow = typeof friendships.$inferSelect;
export type NewFriendshipRow = typeof friendships.$inferInsert;
