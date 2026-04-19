-- WS-04 messaging and durable history: messages, chat_read_state.
-- Mirrors apps/api/src/db/schema/{messages,chat-read-state}.ts and
-- data-model.md §4.13 and §4.16.

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL,
  author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL DEFAULT 'text'
    CHECK (kind IN ('text', 'system', 'attachment')),
  body_text TEXT,
  reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata_json JSONB,
  CONSTRAINT messages_sequence_positive CHECK (sequence > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS messages_chat_sequence_uq
  ON messages (chat_id, sequence);
CREATE INDEX IF NOT EXISTS messages_chat_sequence_desc_idx
  ON messages (chat_id, sequence DESC);
CREATE INDEX IF NOT EXISTS messages_chat_created_idx
  ON messages (chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_author_created_idx
  ON messages (author_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_reply_to_idx
  ON messages (reply_to_message_id);

CREATE TABLE IF NOT EXISTS chat_read_state (
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_sequence BIGINT NOT NULL DEFAULT 0,
  last_opened_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chat_id, user_id),
  CONSTRAINT chat_read_state_last_read_nonneg CHECK (last_read_sequence >= 0)
);

CREATE INDEX IF NOT EXISTS chat_read_state_user_idx
  ON chat_read_state (user_id, updated_at DESC);
