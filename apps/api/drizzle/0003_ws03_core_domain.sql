-- WS-03 core chat domain: rooms, memberships, bans, invitations,
-- direct_chat_participants, friend_requests, friendships, user_blocks, chats.
-- Mirrors apps/api/src/db/schema/{chats,rooms,room-memberships,room-bans,
-- room-invitations,direct-chat-participants,friend-requests,friendships,
-- user-blocks}.ts and data-model.md §4.4–§4.12.

CREATE TABLE IF NOT EXISTS chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('room', 'direct')),
  current_sequence BIGINT NOT NULL DEFAULT 0 CHECK (current_sequence >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS chats_type_deleted_idx ON chats (type, deleted_at);

CREATE TABLE IF NOT EXISTS rooms (
  chat_id UUID PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  description TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS rooms_visibility_normalized_name_idx
  ON rooms (visibility, normalized_name);
CREATE INDEX IF NOT EXISTS rooms_owner_user_id_idx ON rooms (owner_user_id);

CREATE TABLE IF NOT EXISTS room_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_chat_id UUID NOT NULL REFERENCES rooms(chat_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  removed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Partial unique index: only one active (non-left) membership per
-- (room, user) pair. Left memberships are allowed to stack for audit.
CREATE UNIQUE INDEX IF NOT EXISTS room_memberships_active_uq
  ON room_memberships (room_chat_id, user_id)
  WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS room_memberships_user_idx
  ON room_memberships (user_id, left_at);
CREATE INDEX IF NOT EXISTS room_memberships_role_idx
  ON room_memberships (room_chat_id, role, left_at);

CREATE TABLE IF NOT EXISTS room_bans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_chat_id UUID NOT NULL REFERENCES rooms(chat_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS room_bans_active_uq
  ON room_bans (room_chat_id, user_id)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS room_bans_room_removed_idx
  ON room_bans (room_chat_id, removed_at);
CREATE INDEX IF NOT EXISTS room_bans_user_removed_idx
  ON room_bans (user_id, removed_at);

CREATE TABLE IF NOT EXISTS room_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_chat_id UUID NOT NULL REFERENCES rooms(chat_id) ON DELETE CASCADE,
  inviter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL
    CHECK (status IN ('open', 'accepted', 'rejected', 'revoked', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS room_invitations_open_uq
  ON room_invitations (room_chat_id, invitee_user_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS room_invitations_invitee_idx
  ON room_invitations (invitee_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS room_invitations_room_idx
  ON room_invitations (room_chat_id, status);

CREATE TABLE IF NOT EXISTS direct_chat_participants (
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS direct_chat_participants_user_idx
  ON direct_chat_participants (user_id, chat_id);

CREATE TABLE IF NOT EXISTS friend_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('open', 'accepted', 'rejected', 'cancelled', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  CHECK (requester_user_id <> recipient_user_id),
  CHECK (message IS NULL OR char_length(message) <= 500)
);

-- One open request per ordered pair (requester → recipient). If B wants
-- to request A while A→B is open, they'd accept A's request instead.
CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_open_uq
  ON friend_requests (requester_user_id, recipient_user_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS friend_requests_recipient_idx
  ON friend_requests (recipient_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS friend_requests_requester_idx
  ON friend_requests (requester_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_low_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  CHECK (user_low_id < user_high_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS friendships_active_uq
  ON friendships (user_low_id, user_high_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS friendships_user_low_idx
  ON friendships (user_low_id, ended_at);
CREATE INDEX IF NOT EXISTS friendships_user_high_idx
  ON friendships (user_high_id, ended_at);

CREATE TABLE IF NOT EXISTS user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  CHECK (blocker_user_id <> blocked_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_blocks_active_uq
  ON user_blocks (blocker_user_id, blocked_user_id)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS user_blocks_blocker_idx
  ON user_blocks (blocker_user_id, removed_at);
CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx
  ON user_blocks (blocked_user_id, removed_at);
