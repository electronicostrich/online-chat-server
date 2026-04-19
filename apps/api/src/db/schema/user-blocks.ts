import { pgTable, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';

// Maps to data-model.md §4.6. Blocks are directional; a mutual block is
// two rows. Active block = removed_at IS NULL.
export const userBlocks = pgTable(
  'user_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    blockerUserId: uuid('blocker_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedUserId: uuid('blocked_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (t) => [
    index('user_blocks_blocker_idx').on(t.blockerUserId, t.removedAt),
    index('user_blocks_blocked_idx').on(t.blockedUserId, t.removedAt),
  ],
);

export type UserBlockRow = typeof userBlocks.$inferSelect;
export type NewUserBlockRow = typeof userBlocks.$inferInsert;
