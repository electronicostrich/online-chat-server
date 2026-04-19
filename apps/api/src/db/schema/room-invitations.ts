import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { rooms } from './rooms.js';
import { users } from './users.js';

// Maps to data-model.md §4.11. `status` covers the full lifecycle so a
// historical query can distinguish "open" (unresolved) from "rejected"
// (closed negatively) vs. "revoked" (cancelled by inviter). The partial
// unique index on `(room, invitee) WHERE status='open'` mirrors the
// migration.
export const roomInvitations = pgTable(
  'room_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomChatId: uuid('room_chat_id')
      .notNull()
      .references(() => rooms.chatId, { onDelete: 'cascade' }),
    inviterUserId: uuid('inviter_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    inviteeUserId: uuid('invitee_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', {
      enum: ['open', 'accepted', 'rejected', 'revoked', 'expired'],
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('room_invitations_open_uq')
      .on(t.roomChatId, t.inviteeUserId)
      .where(sql`${t.status} = 'open'`),
    index('room_invitations_invitee_idx').on(
      t.inviteeUserId,
      t.status,
      t.createdAt,
    ),
    index('room_invitations_room_idx').on(t.roomChatId, t.status),
  ],
);

export type RoomInvitationRow = typeof roomInvitations.$inferSelect;
export type NewRoomInvitationRow = typeof roomInvitations.$inferInsert;
