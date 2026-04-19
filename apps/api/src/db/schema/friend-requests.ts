import { pgTable, text, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';

// Maps to data-model.md §4.4. One open request per ordered
// (requester → recipient) pair is enforced by a partial unique index in
// the migration. Reverse direction while open is allowed but UI should
// instead prompt to accept; acceptance is idempotent.
export const friendRequests = pgTable(
  'friend_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requesterUserId: uuid('requester_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recipientUserId: uuid('recipient_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    message: text('message'),
    status: text('status', {
      enum: ['open', 'accepted', 'rejected', 'cancelled', 'expired'],
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [
    index('friend_requests_recipient_idx').on(
      t.recipientUserId,
      t.status,
      t.createdAt,
    ),
    index('friend_requests_requester_idx').on(
      t.requesterUserId,
      t.status,
      t.createdAt,
    ),
  ],
);

export type FriendRequestRow = typeof friendRequests.$inferSelect;
export type NewFriendRequestRow = typeof friendRequests.$inferInsert;
