// Developer-fixture seed. Idempotent: safe to run repeatedly against a
// migrated database. Pure INSERT + INSERT ... ON CONFLICT DO NOTHING —
// no DROP / TRUNCATE (the dev/prod seed is not a reset tool; see
// docs/ai-development-guardrails.md §5.5). `/__test/seed` is the
// reset-capable counterpart for Playwright runs.
//
// Intentionally dev-only: aborts under NODE_ENV=production because
// (a) the fixture passwords are well-known, (b) the seeded rooms would
// pollute a real user's catalog, and (c) the prod bootstrap sequence
// has no legitimate need for this data. Running under NODE_ENV=test is
// allowed so the `pnpm --filter api db:seed` path can itself be
// exercised by vitest integration coverage.
import { hashPassword } from '../modules/auth/password.js';
import {
  normalizeEmail,
  normalizeUsername,
} from '../modules/auth/normalize.js';
import { normalizeRoomName } from '../modules/rooms/normalize.js';
import { logger } from '../logger.js';
import type { Sql } from 'postgres';

export interface SeedUserSpec {
  username: string;
  email: string;
  password: string;
}

export interface SeedRoomSpec {
  name: string;
  visibility: 'public' | 'private';
  ownerUsername: string;
  members: { username: string; role: 'admin' | 'member' }[];
}

export interface SeedFriendshipSpec {
  userA: string;
  userB: string;
}

export interface SeedBlockSpec {
  blocker: string;
  blocked: string;
}

export interface SeedMessageSpec {
  roomName: string;
  authorUsername: string;
  bodyText: string;
}

export interface SeedPlan {
  users: SeedUserSpec[];
  rooms: SeedRoomSpec[];
  friendships: SeedFriendshipSpec[];
  blocks: SeedBlockSpec[];
  messages: SeedMessageSpec[];
}

// The canonical dev fixture. A deliberately small set — just enough to
// boot into a non-empty UI and exercise room + DM + block flows without
// hand-crafting data. Every string here is dev-only and intentionally
// well-known; anyone running a production build gets a hard refusal
// (see runSeed) before these ever reach a real database.
export const DEV_FIXTURE: SeedPlan = {
  users: [
    { username: 'alice', email: 'alice@chat.local', password: 'Password123!' },
    { username: 'bob', email: 'bob@chat.local', password: 'Password123!' },
    {
      username: 'charlie',
      email: 'charlie@chat.local',
      password: 'Password123!',
    },
    { username: 'dana', email: 'dana@chat.local', password: 'Password123!' },
  ],
  rooms: [
    {
      name: 'general',
      visibility: 'public',
      ownerUsername: 'alice',
      members: [
        { username: 'bob', role: 'admin' },
        { username: 'charlie', role: 'member' },
      ],
    },
    {
      name: 'random',
      visibility: 'public',
      ownerUsername: 'alice',
      members: [{ username: 'charlie', role: 'member' }],
    },
    {
      name: 'founders',
      visibility: 'private',
      ownerUsername: 'alice',
      members: [{ username: 'bob', role: 'admin' }],
    },
  ],
  friendships: [{ userA: 'alice', userB: 'bob' }],
  blocks: [{ blocker: 'charlie', blocked: 'dana' }],
  messages: [
    {
      roomName: 'general',
      authorUsername: 'alice',
      bodyText: 'Welcome to #general. This is seeded dev data.',
    },
    {
      roomName: 'general',
      authorUsername: 'bob',
      bodyText: 'Hey alice, the fixtures look good.',
    },
    {
      roomName: 'general',
      authorUsername: 'charlie',
      bodyText: 'ping',
    },
  ],
};

export interface RunSeedResult {
  usersCreated: number;
  roomsCreated: number;
  friendshipsCreated: number;
  blocksCreated: number;
  messagesCreated: number;
}

// The Drizzle `db` client returns typed rows but the seed needs ad-hoc
// shapes — easier to stay on the raw `postgres` client where the
// parameterised tagged-template form is already the interpolation-safe
// path. Callers inject the client so the vitest harness can hand in an
// isolated sqlconnection without touching the module-level pool.
export async function runSeed(
  sql: Sql,
  plan: SeedPlan = DEV_FIXTURE,
): Promise<RunSeedResult> {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (nodeEnv === 'production') {
    throw new Error(
      'db:seed is dev-only and refuses to run under NODE_ENV=production. ' +
        'Provision production data through the documented onboarding flow.',
    );
  }

  const result: RunSeedResult = {
    usersCreated: 0,
    roomsCreated: 0,
    friendshipsCreated: 0,
    blocksCreated: 0,
    messagesCreated: 0,
  };

  // --- users ------------------------------------------------------------
  const userIdByUsername = new Map<string, string>();
  for (const u of plan.users) {
    const emailCanonical = normalizeEmail(u.email);
    const usernameCanonical = normalizeUsername(u.username);
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE email_canonical = ${emailCanonical} LIMIT 1
    `;
    const already = existing[0];
    if (already !== undefined) {
      userIdByUsername.set(u.username, already.id);
      continue;
    }
    const passwordHash = await hashPassword(u.password);
    // Target-less `ON CONFLICT DO NOTHING` so a collision on either
    // `email_canonical` OR `username_canonical` surfaces as a no-op
    // insert rather than a raw constraint violation. A caller-supplied
    // plan that reuses a username with a different email (e.g., "Alice"
    // and "alice") will then re-SELECT by email_canonical below and
    // either adopt the existing row or throw a clear "vanished" error.
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO users (email, email_canonical, username, username_canonical, password_hash)
      VALUES (${u.email.trim()}, ${emailCanonical}, ${u.username.trim()}, ${usernameCanonical}, ${passwordHash})
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    const newRow = inserted[0];
    if (newRow !== undefined) {
      userIdByUsername.set(u.username, newRow.id);
      result.usersCreated += 1;
    } else {
      // Conflict branch: either a concurrent seed won the race
      // (email_canonical hit) or the plan reused a canonical username.
      // Re-SELECT by email_canonical first — that's the natural key for
      // the fixture plan. If the row isn't there either, surface the
      // username collision to the caller rather than silently dropping.
      const after = await sql<{ id: string }[]>`
        SELECT id FROM users WHERE email_canonical = ${emailCanonical} LIMIT 1
      `;
      const row = after[0];
      if (row === undefined) {
        throw new Error(
          `seed: user ${u.username} (${u.email}) could not be inserted — ` +
            'likely a username_canonical collision with an existing row under a different email',
        );
      }
      userIdByUsername.set(u.username, row.id);
    }
  }

  function requireUserId(username: string): string {
    const id = userIdByUsername.get(username);
    if (id === undefined) {
      throw new Error(`seed: unknown user ${JSON.stringify(username)}`);
    }
    return id;
  }

  // --- rooms + owner-membership + extra members ------------------------
  // Keyed by normalized name so a hand-authored plan that spells the
  // same room two ways (`"General"` vs `" general "`) still resolves to
  // a single chat id when messages later look it up.
  const roomChatIdByNormalizedName = new Map<string, string>();
  for (const r of plan.rooms) {
    const normalizedName = normalizeRoomName(r.name);
    const ownerId = requireUserId(r.ownerUsername);
    const existing = await sql<{ chat_id: string }[]>`
      SELECT chat_id FROM rooms WHERE normalized_name = ${normalizedName} LIMIT 1
    `;
    const already = existing[0];
    let chatId: string;
    if (already !== undefined) {
      chatId = already.chat_id;
    } else {
      // chat + room + owner membership live in a single transaction so a
      // half-seeded state never leaves an orphan chat without a room row.
      // `sql.begin` matches postgres-js's transaction semantics; the
      // callback's resolved value becomes the transaction's result.
      //
      // The pre-read above is advisory, not authoritative — the
      // `rooms.normalized_name` unique index is the real lock, and a
      // second seeder that raced past the pre-read will bounce off it
      // here. We catch that violation and re-SELECT by normalized name
      // so concurrent seeders converge on the winning row rather than
      // one of them erroring out.
      try {
        chatId = await sql.begin(async (tx) => {
          const chatRows = await tx<{ id: string }[]>`
            INSERT INTO chats (type) VALUES ('room') RETURNING id
          `;
          const chatRow = chatRows[0];
          if (chatRow === undefined) {
            throw new Error('seed: chat insert returned no row');
          }
          await tx`
            INSERT INTO rooms (chat_id, name, normalized_name, visibility, owner_user_id)
            VALUES (${chatRow.id}, ${r.name.trim()}, ${normalizedName}, ${r.visibility}, ${ownerId})
          `;
          await tx`
            INSERT INTO room_memberships (room_chat_id, user_id, role)
            VALUES (${chatRow.id}, ${ownerId}, 'owner')
          `;
          return chatRow.id;
        });
        result.roomsCreated += 1;
      } catch (err) {
        const after = await sql<{ chat_id: string }[]>`
          SELECT chat_id FROM rooms WHERE normalized_name = ${normalizedName} LIMIT 1
        `;
        const row = after[0];
        if (row === undefined) throw err;
        chatId = row.chat_id;
      }
    }
    roomChatIdByNormalizedName.set(normalizedName, chatId);

    // Non-owner members — idempotent via the partial unique index on
    // (room_chat_id, user_id) WHERE left_at IS NULL.
    for (const m of r.members) {
      const memberId = requireUserId(m.username);
      await sql`
        INSERT INTO room_memberships (room_chat_id, user_id, role)
        VALUES (${chatId}, ${memberId}, ${m.role})
        ON CONFLICT DO NOTHING
      `;
    }
  }

  // --- friendships -----------------------------------------------------
  for (const f of plan.friendships) {
    const aId = requireUserId(f.userA);
    const bId = requireUserId(f.userB);
    const [low, high] = aId < bId ? [aId, bId] : [bId, aId];
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO friendships (user_low_id, user_high_id)
      VALUES (${low}, ${high})
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (inserted.length > 0) result.friendshipsCreated += 1;
  }

  // --- blocks ----------------------------------------------------------
  for (const b of plan.blocks) {
    const blockerId = requireUserId(b.blocker);
    const blockedId = requireUserId(b.blocked);
    if (blockerId === blockedId) continue;
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO user_blocks (blocker_user_id, blocked_user_id)
      VALUES (${blockerId}, ${blockedId})
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (inserted.length > 0) result.blocksCreated += 1;
  }

  // --- sample messages -------------------------------------------------
  // Keyed by (chat_id, author, body_text) to avoid re-inserting the same
  // seeded line on every run. Each insert bumps the chat's
  // current_sequence atomically, matching the WS-04 allocation path.
  //
  // The dedup SELECT and the allocation UPDATE run inside the same
  // transaction so two concurrent seeders can't both miss the check and
  // insert the same body twice with different sequences. A
  // transaction-scoped advisory lock (`pg_advisory_xact_lock`, released
  // on COMMIT / ROLLBACK) serialises the check+insert for a given
  // (chat, author, body) tuple without taking an exclusive lock on the
  // whole chats row.
  for (const m of plan.messages) {
    const chatId = roomChatIdByNormalizedName.get(normalizeRoomName(m.roomName));
    if (chatId === undefined) {
      throw new Error(`seed: message references unknown room ${m.roomName}`);
    }
    const authorId = requireUserId(m.authorUsername);
    const lockKey = `seed-message:${chatId}:${authorId}:${m.bodyText}`;
    const inserted = await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const existing = await tx<{ id: string }[]>`
        SELECT id FROM messages
        WHERE chat_id = ${chatId}
          AND author_user_id = ${authorId}
          AND body_text = ${m.bodyText}
        LIMIT 1
      `;
      if (existing.length > 0) return false;
      const chatRows = await tx<{ current_sequence: number | string }[]>`
        UPDATE chats
           SET current_sequence = current_sequence + 1
         WHERE id = ${chatId} AND deleted_at IS NULL
         RETURNING current_sequence
      `;
      const chatRow = chatRows[0];
      if (chatRow === undefined) {
        throw new Error(`seed: chat ${chatId} vanished before message insert`);
      }
      const nextSequence = Number(chatRow.current_sequence);
      await tx`
        INSERT INTO messages (chat_id, sequence, author_user_id, kind, body_text)
        VALUES (${chatId}, ${nextSequence}, ${authorId}, 'text', ${m.bodyText})
      `;
      return true;
    });
    if (inserted) result.messagesCreated += 1;
  }

  logger.info(
    {
      usersCreated: result.usersCreated,
      roomsCreated: result.roomsCreated,
      friendshipsCreated: result.friendshipsCreated,
      blocksCreated: result.blocksCreated,
      messagesCreated: result.messagesCreated,
      totalPlanned: {
        users: plan.users.length,
        rooms: plan.rooms.length,
        friendships: plan.friendships.length,
        blocks: plan.blocks.length,
        messages: plan.messages.length,
      },
    },
    'db:seed complete',
  );
  return result;
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === `file://${entrypoint}`) {
  // Importing the client lazily keeps `runSeed`'s unit tests free of the
  // real postgres pool.
  const run = async (): Promise<void> => {
    const { pgSql } = await import('./client.js');
    try {
      await runSeed(pgSql);
    } finally {
      await pgSql.end();
    }
  };
  run().then(
    () => {
      process.exit(0);
    },
    (err: unknown) => {
      logger.error({ err }, 'db:seed failed');
      process.exit(1);
    },
  );
}
