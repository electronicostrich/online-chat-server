-- WS-06 attachments and file access: attachments metadata table.
-- Mirrors apps/api/src/db/schema/attachments.ts and data-model.md §4.15.
-- Binary files live under `<ATTACHMENT_ROOT_DIR>/<chat_id>/<attachment_id>`
-- on disk; this table is metadata only.

CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  original_filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT NOT NULL,
  comment_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT attachments_size_bytes_nonneg CHECK (size_bytes >= 0)
);

CREATE INDEX IF NOT EXISTS attachments_chat_created_idx
  ON attachments (chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS attachments_message_idx
  ON attachments (message_id);
CREATE INDEX IF NOT EXISTS attachments_uploader_idx
  ON attachments (uploaded_by_user_id);
