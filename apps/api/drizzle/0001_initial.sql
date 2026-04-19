-- First migration: minimum schema to support /healthz and /__test/seed.
-- Stage 1 adds: users, sessions, friendships, blocks, rooms, room_memberships,
-- room_invitations, room_bans, messages, attachments, chat_read_state.
-- This file intentionally contains only a sentinel to prove the migration runner works.

CREATE TABLE IF NOT EXISTS _bootstrap_sentinel (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO _bootstrap_sentinel (key, value) VALUES ('version', '0.1.0')
  ON CONFLICT (key) DO NOTHING;
