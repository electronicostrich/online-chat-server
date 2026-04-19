import { pgTable, text, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { chats } from './chats.js';
import { users } from './users.js';

// Maps to data-model.md §4.8. `normalized_name` stores the canonical form
// (trim + NFC + whitespace-collapse + lowercase) for case-insensitive
// uniqueness without DB-level collation magic.
export const rooms = pgTable(
  'rooms',
  {
    chatId: uuid('chat_id')
      .primaryKey()
      .references(() => chats.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull().unique(),
    description: text('description'),
    visibility: text('visibility', { enum: ['public', 'private'] }).notNull(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('rooms_visibility_normalized_name_idx').on(
      t.visibility,
      t.normalizedName,
    ),
    index('rooms_owner_user_id_idx').on(t.ownerUserId),
  ],
);

export type RoomRow = typeof rooms.$inferSelect;
export type NewRoomRow = typeof rooms.$inferInsert;
