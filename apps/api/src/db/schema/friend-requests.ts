import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { FRIEND_REQUEST_MESSAGE_MAX_LENGTH } from 'shared-schemas';
import { users } from './users.js';

// Maps to data-model.md §4.4. One open request per ordered
// (requester → recipient) pair is enforced by the partial unique index
// below (mirrors migration 0003). The reverse direction can still be
// open (A→B and B→A); UI prompts the second caller to accept the
// existing request rather than create a new row.
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
    uniqueIndex('friend_requests_open_uq')
      .on(t.requesterUserId, t.recipientUserId)
      .where(sql`${t.status} = 'open'`),
    check(
      'friend_requests_requester_recipient_ne',
      sql`${t.requesterUserId} <> ${t.recipientUserId}`,
    ),
    check(
      'friend_requests_message_length',
      sql`${t.message} IS NULL OR char_length(${t.message}) <= ${sql.raw(String(FRIEND_REQUEST_MESSAGE_MAX_LENGTH))}`,
    ),
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
