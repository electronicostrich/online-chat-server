import { pgTable, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { rooms } from './rooms.js';
import { users } from './users.js';

// Maps to data-model.md §4.12. Active ban = removed_at IS NULL. Unban is
// a soft-delete (set removed_at) to preserve audit.
export const roomBans = pgTable(
  'room_bans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomChatId: uuid('room_chat_id')
      .notNull()
      .references(() => rooms.chatId, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bannedByUserId: uuid('banned_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (t) => [
    index('room_bans_room_removed_idx').on(t.roomChatId, t.removedAt),
    index('room_bans_user_removed_idx').on(t.userId, t.removedAt),
  ],
);

export type RoomBanRow = typeof roomBans.$inferSelect;
export type NewRoomBanRow = typeof roomBans.$inferInsert;
