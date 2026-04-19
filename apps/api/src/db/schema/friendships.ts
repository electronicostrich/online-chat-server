import {
  pgTable,
  timestamp,
  uuid,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';

// Maps to data-model.md §4.5. Symmetric friendships are stored as an
// ordered pair (user_low_id < user_high_id). The CHECK constraint +
// partial unique index below mirror migration 0003 and are the DB-side
// guarantee that the application "pair first, then insert" code can't
// slip a duplicate or mis-ordered row past the type system.
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
    uniqueIndex('friendships_active_uq')
      .on(t.userLowId, t.userHighId)
      .where(sql`${t.endedAt} IS NULL`),
    check(
      'friendships_ordered_pair',
      sql`${t.userLowId} < ${t.userHighId}`,
    ),
    index('friendships_user_low_idx').on(t.userLowId, t.endedAt),
    index('friendships_user_high_idx').on(t.userHighId, t.endedAt),
  ],
);

export type FriendshipRow = typeof friendships.$inferSelect;
export type NewFriendshipRow = typeof friendships.$inferInsert;
