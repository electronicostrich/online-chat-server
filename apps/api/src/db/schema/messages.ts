import {
  pgTable,
  text,
  timestamp,
  uuid,
  bigint,
  index,
  uniqueIndex,
  jsonb,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { chats } from './chats.js';
import { users } from './users.js';

// Maps to data-model.md §4.13. `sequence` is chat-local and allocated by
// the send-message transaction in apps/api/src/modules/messages/repository.ts.
// The partial unique index on `(chat_id, sequence)` plus the CHECK on
// `sequence > 0` are the DB-side guarantees that a dropped allocation
// path cannot persist a duplicate or zero-sequence row.
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: ['text', 'system', 'attachment'] })
      .notNull()
      .default('text'),
    bodyText: text('body_text'),
    replyToMessageId: uuid('reply_to_message_id').references((): AnyPgColumn => messages.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByUserId: uuid('deleted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    metadataJson: jsonb('metadata_json'),
  },
  (t) => [
    uniqueIndex('messages_chat_sequence_uq').on(t.chatId, t.sequence),
    check('messages_sequence_positive', sql`${t.sequence} > 0`),
    index('messages_chat_sequence_desc_idx').on(t.chatId, sql`sequence DESC`),
    index('messages_chat_created_idx').on(t.chatId, sql`created_at DESC`),
    index('messages_author_created_idx').on(t.authorUserId, sql`created_at DESC`),
    index('messages_reply_to_idx').on(t.replyToMessageId),
  ],
);

export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
