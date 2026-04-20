import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users, type UserRow } from '../../db/schema/users.js';
import {
  sessions,
  type NewSessionRow,
  type SessionRow,
} from '../../db/schema/sessions.js';
import {
  passwordResetTokens,
  type NewPasswordResetTokenRow,
  type PasswordResetTokenRow,
} from '../../db/schema/password-reset-tokens.js';
import { chats } from '../../db/schema/chats.js';
import { rooms } from '../../db/schema/rooms.js';
import { roomMemberships } from '../../db/schema/room-memberships.js';
import { friendships } from '../../db/schema/friendships.js';
import { friendRequests } from '../../db/schema/friend-requests.js';
import { userBlocks } from '../../db/schema/user-blocks.js';

export interface CreateUserParams {
  email: string;
  emailCanonical: string;
  username: string;
  usernameCanonical: string;
  passwordHash: string;
}

export async function findUserByEmailCanonical(
  emailCanonical: string,
): Promise<UserRow | undefined> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.emailCanonical, emailCanonical))
    .limit(1);
  return rows[0];
}

export async function findUserByUsernameCanonical(
  usernameCanonical: string,
): Promise<UserRow | undefined> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.usernameCanonical, usernameCanonical))
    .limit(1);
  return rows[0];
}

export async function insertUser(params: CreateUserParams): Promise<UserRow> {
  const [row] = await db.insert(users).values(params).returning();
  if (row === undefined) {
    throw new Error('insertUser returned no row');
  }
  return row;
}

export async function insertSession(params: NewSessionRow): Promise<SessionRow> {
  const [row] = await db.insert(sessions).values(params).returning();
  if (row === undefined) {
    throw new Error('insertSession returned no row');
  }
  return row;
}

export async function findActiveSessionByTokenHash(
  tokenHash: string,
): Promise<(SessionRow & { user: UserRow }) | undefined> {
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(eq(sessions.sessionTokenHash, tokenHash), isNull(sessions.revokedAt)),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) return undefined;
  return { ...row.session, user: row.user };
}

export async function revokeSessionById(sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

export async function listActiveSessionsForUser(
  userId: string,
): Promise<SessionRow[]> {
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function touchSessionLastSeen(sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.id, sessionId));
}

export async function updateUserPasswordHash(
  userId: string,
  passwordHash: string,
): Promise<void> {
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function revokeSessionsForUserExcept(
  userId: string,
  keepSessionId: string,
): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        ne(sessions.id, keepSessionId),
      ),
    );
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function insertPasswordResetToken(
  row: NewPasswordResetTokenRow,
): Promise<PasswordResetTokenRow> {
  const [inserted] = await db.insert(passwordResetTokens).values(row).returning();
  if (inserted === undefined) {
    throw new Error('insertPasswordResetToken returned no row');
  }
  return inserted;
}

export async function findResetTokenByHash(
  tokenHash: string,
): Promise<PasswordResetTokenRow | undefined> {
  const rows = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, tokenHash))
    .limit(1);
  return rows[0];
}

export async function markResetTokenConsumed(tokenId: string): Promise<void> {
  await db
    .update(passwordResetTokens)
    .set({ consumedAt: new Date() })
    .where(eq(passwordResetTokens.id, tokenId));
}

export async function revokeActiveResetTokensForUser(
  userId: string,
): Promise<void> {
  await db
    .update(passwordResetTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.userId, userId),
        isNull(passwordResetTokens.consumedAt),
        isNull(passwordResetTokens.revokedAt),
      ),
    );
}

export interface AccountDeletionResult {
  revokedSessionIds: string[];
}

// Performs the AC-AUTH-09 cascade in a single transaction so a partial
// failure never leaves the user soft-deleted with live rooms or sessions.
// Scope matches api-and-events.md §5.1 DELETE /users/me:
//   - user → status='deleted', deleted_at=now
//   - every active session → revoked
//   - every owned room (and its chat) → soft-deleted (deleted_at=now)
//   - every non-owned active membership → leftAt=now
//   - friendships involving the user → hard-delete (per §9 retention)
//   - open friend requests sent or received by the user → cancelled
//   - user_blocks involving the user → hard-delete (per §9 retention)
//
// Email/username canonical columns are NOT released; the row is retained
// until the 90-day hard-purge window to preserve surviving-room
// attribution, so the same credentials cannot immediately re-register.
export async function cascadeDeleteUser(
  userId: string,
): Promise<AccountDeletionResult> {
  return db.transaction(async (tx) => {
    const now = new Date();

    const [userRow] = await tx
      .update(users)
      .set({ status: 'deleted', deletedAt: now, updatedAt: now })
      .where(and(eq(users.id, userId), eq(users.status, 'active')))
      .returning({ id: users.id });
    if (userRow === undefined) {
      // The row flipped to deleted between the preflight password check
      // and the cascade transaction. Nothing left to do — the caller's
      // session may have been revoked by a parallel path, so bail early
      // and let the route clear cookies and respond OK.
      return { revokedSessionIds: [] };
    }

    const revokedSessions = await tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });

    const ownedRooms = await tx
      .select({ chatId: rooms.chatId })
      .from(rooms)
      .where(
        and(eq(rooms.ownerUserId, userId), isNull(rooms.deletedAt)),
      );
    if (ownedRooms.length > 0) {
      const ownedChatIds = ownedRooms.map((r) => r.chatId);
      await tx
        .update(rooms)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(eq(rooms.ownerUserId, userId), isNull(rooms.deletedAt)),
        );
      await tx
        .update(chats)
        .set({ deletedAt: now })
        .where(
          and(isNull(chats.deletedAt), inArray(chats.id, ownedChatIds)),
        );
    }

    await tx
      .update(roomMemberships)
      .set({ leftAt: now })
      .where(
        and(
          eq(roomMemberships.userId, userId),
          isNull(roomMemberships.leftAt),
          ne(roomMemberships.role, 'owner'),
        ),
      );

    await tx
      .delete(friendships)
      .where(
        or(eq(friendships.userLowId, userId), eq(friendships.userHighId, userId)),
      );

    await tx
      .update(friendRequests)
      .set({ status: 'cancelled', respondedAt: now })
      .where(
        and(
          eq(friendRequests.status, 'open'),
          or(
            eq(friendRequests.requesterUserId, userId),
            eq(friendRequests.recipientUserId, userId),
          ),
        ),
      );

    await tx
      .delete(userBlocks)
      .where(
        or(
          eq(userBlocks.blockerUserId, userId),
          eq(userBlocks.blockedUserId, userId),
        ),
      );

    return { revokedSessionIds: revokedSessions.map((s) => s.id) };
  });
}
