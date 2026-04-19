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

// Maps to data-model.md §4.6. Blocks are directional; a mutual block is
// two rows. Active block = removed_at IS NULL. The CHECK constraint and
// partial unique index mirror migration 0003 so any direct-SQL writer
// outside the service layer still can't slip a self-block or duplicate
// active block past the DB.
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
    uniqueIndex('user_blocks_active_uq')
      .on(t.blockerUserId, t.blockedUserId)
      .where(sql`${t.removedAt} IS NULL`),
    check(
      'user_blocks_blocker_blocked_ne',
      sql`${t.blockerUserId} <> ${t.blockedUserId}`,
    ),
    index('user_blocks_blocker_idx').on(t.blockerUserId, t.removedAt),
    index('user_blocks_blocked_idx').on(t.blockedUserId, t.removedAt),
  ],
);

export type UserBlockRow = typeof userBlocks.$inferSelect;
export type NewUserBlockRow = typeof userBlocks.$inferInsert;
