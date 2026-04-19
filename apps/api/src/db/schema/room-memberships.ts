import { pgTable, text, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { rooms } from './rooms.js';
import { users } from './users.js';

// Maps to data-model.md §4.10. Unique active membership per (room, user)
// is enforced by a partial unique index (`left_at IS NULL`) in the
// migration.
export const roomMemberships = pgTable(
  'room_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomChatId: uuid('room_chat_id')
      .notNull()
      .references(() => rooms.chatId, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    leftAt: timestamp('left_at', { withTimezone: true }),
    removedByUserId: uuid('removed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('room_memberships_user_idx').on(t.userId, t.leftAt),
    index('room_memberships_role_idx').on(t.roomChatId, t.role, t.leftAt),
  ],
);

export type RoomMembershipRow = typeof roomMemberships.$inferSelect;
export type NewRoomMembershipRow = typeof roomMemberships.$inferInsert;
