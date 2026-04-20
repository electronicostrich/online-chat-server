import {
  pgTable,
  text,
  timestamp,
  uuid,
  bigint,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { chats } from './chats.js';
import { messages } from './messages.js';
import { users } from './users.js';

// Maps to data-model.md §4.15. Attachment metadata; the binary file lives
// under `<ATTACHMENT_ROOT_DIR>/<chat_id>/<attachment_id>` on disk so
// per-chat cleanup is a single directory walk. `message_id` is mandatory
// in this slice (every attachment currently creates a sibling
// `kind='attachment'` message row in the same transaction — pre-message
// draft staging is not part of WS-06). Cascades mirror the ones declared
// on `messages`: CASCADE on chat deletion (follows the chat-level soft-
// then-hard-purge pipeline) and CASCADE on message deletion (a hard-
// purged parent message takes its attachment row with it). The
// `uploaded_by_user_id` FK is SET NULL on user deletion so historical
// attachments survive an uploader's account deletion the same way
// moderation-deleted messages survive.
export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    originalFilename: text('original_filename').notNull(),
    storagePath: text('storage_path').notNull(),
    mimeType: text('mime_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    commentText: text('comment_text'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('attachments_chat_created_idx').on(t.chatId, sql`created_at DESC`),
    index('attachments_message_idx').on(t.messageId),
    index('attachments_uploader_idx').on(t.uploadedByUserId),
  ],
);

export type AttachmentRow = typeof attachments.$inferSelect;
export type NewAttachmentRow = typeof attachments.$inferInsert;
