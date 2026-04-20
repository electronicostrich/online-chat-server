import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users, type UserRow } from '../../db/schema/users.js';
import {
  friendRequests,
  type FriendRequestRow,
} from '../../db/schema/friend-requests.js';
import { userBlocks } from '../../db/schema/user-blocks.js';
import { friendships, type FriendshipRow } from '../../db/schema/friendships.js';

export async function findActiveBlockBetween(
  aUserId: string,
  bUserId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: userBlocks.id })
    .from(userBlocks)
    .where(
      and(
        isNull(userBlocks.removedAt),
        or(
          and(
            eq(userBlocks.blockerUserId, aUserId),
            eq(userBlocks.blockedUserId, bUserId),
          ),
          and(
            eq(userBlocks.blockerUserId, bUserId),
            eq(userBlocks.blockedUserId, aUserId),
          ),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function findActiveFriendshipBetween(
  aUserId: string,
  bUserId: string,
): Promise<boolean> {
  const [low, high] = aUserId < bUserId ? [aUserId, bUserId] : [bUserId, aUserId];
  const rows = await db
    .select({ id: friendships.id })
    .from(friendships)
    .where(
      and(
        eq(friendships.userLowId, low),
        eq(friendships.userHighId, high),
        isNull(friendships.endedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function findOpenFriendRequest(
  requesterUserId: string,
  recipientUserId: string,
): Promise<FriendRequestRow | undefined> {
  const rows = await db
    .select()
    .from(friendRequests)
    .where(
      and(
        eq(friendRequests.requesterUserId, requesterUserId),
        eq(friendRequests.recipientUserId, recipientUserId),
        eq(friendRequests.status, 'open'),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function insertFriendRequest(params: {
  requesterUserId: string;
  recipientUserId: string;
  message: string | null;
}): Promise<FriendRequestRow> {
  const [row] = await db
    .insert(friendRequests)
    .values({
      requesterUserId: params.requesterUserId,
      recipientUserId: params.recipientUserId,
      message: params.message,
      status: 'open',
    })
    .returning();
  if (row === undefined) {
    throw new Error('insertFriendRequest returned no row');
  }
  return row;
}

export {
  extractPgConstraint,
  isUniqueViolation,
} from '../../shared/pg-errors.js';

export async function findUserByUsernameCanonical(
  usernameCanonical: string,
): Promise<UserRow | undefined> {
  const rows = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.usernameCanonical, usernameCanonical),
        eq(users.status, 'active'),
      ),
    )
    .limit(1);
  return rows[0];
}

// Exported so tests / other modules can count open requests cheaply.
export async function countOpenRequestsFrom(
  requesterUserId: string,
): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(friendRequests)
    .where(
      and(
        eq(friendRequests.requesterUserId, requesterUserId),
        eq(friendRequests.status, 'open'),
      ),
    );
  return row?.c ?? 0;
}

export async function findFriendRequestById(
  id: string,
): Promise<FriendRequestRow | undefined> {
  const rows = await db
    .select()
    .from(friendRequests)
    .where(eq(friendRequests.id, id))
    .limit(1);
  return rows[0];
}

// Accept an open friend request atomically:
//   1. close the request (status = 'accepted', responded_at = NOW())
//   2. upsert a friendship row on the canonical ordered pair
// If the request was already closed by another call, the UPDATE matches
// zero rows and we return undefined so the service can map to CONFLICT
// or NOT_FOUND.
export async function acceptFriendRequest(
  requestId: string,
  recipientUserId: string,
): Promise<{ request: FriendRequestRow; friendship: FriendshipRow } | undefined> {
  return db.transaction(async (tx) => {
    const [closed] = await tx
      .update(friendRequests)
      .set({ status: 'accepted', respondedAt: sql`NOW()` })
      .where(
        and(
          eq(friendRequests.id, requestId),
          eq(friendRequests.recipientUserId, recipientUserId),
          eq(friendRequests.status, 'open'),
        ),
      )
      .returning();
    if (closed === undefined) return undefined;
    const [low, high] =
      closed.requesterUserId < closed.recipientUserId
        ? [closed.requesterUserId, closed.recipientUserId]
        : [closed.recipientUserId, closed.requesterUserId];
    // ON CONFLICT DO NOTHING against the partial unique index so a
    // pre-existing active friendship (e.g., request re-opened after a
    // remove) doesn't trip a 500.
    await tx.execute(sql`
      INSERT INTO ${friendships} (user_low_id, user_high_id)
      VALUES (${low}, ${high})
      ON CONFLICT (user_low_id, user_high_id)
        WHERE ended_at IS NULL
        DO NOTHING
    `);
    const [friendship] = await tx
      .select()
      .from(friendships)
      .where(
        and(
          eq(friendships.userLowId, low),
          eq(friendships.userHighId, high),
          isNull(friendships.endedAt),
        ),
      )
      .limit(1);
    if (friendship === undefined) {
      throw new Error('acceptFriendRequest: friendship row not found');
    }
    return { request: closed, friendship };
  });
}

// Reject an open request: just close it. No friendship row is created.
export async function rejectFriendRequest(
  requestId: string,
  recipientUserId: string,
): Promise<FriendRequestRow | undefined> {
  const [closed] = await db
    .update(friendRequests)
    .set({ status: 'rejected', respondedAt: sql`NOW()` })
    .where(
      and(
        eq(friendRequests.id, requestId),
        eq(friendRequests.recipientUserId, recipientUserId),
        eq(friendRequests.status, 'open'),
      ),
    )
    .returning();
  return closed;
}

// End the active friendship between A and B. Returns true if a row was
// updated. The DM-freeze that AC-DM-03 mandates is a read-side property:
// WS-04's send path checks `hasActiveFriendship` and rejects once the
// friendship row is gone (or ended_at set). No extra state is written.
export async function endFriendship(aUserId: string, bUserId: string): Promise<boolean> {
  const [low, high] = aUserId < bUserId ? [aUserId, bUserId] : [bUserId, aUserId];
  const updated = await db
    .update(friendships)
    .set({ endedAt: sql`NOW()` })
    .where(
      and(
        eq(friendships.userLowId, low),
        eq(friendships.userHighId, high),
        isNull(friendships.endedAt),
      ),
    )
    .returning({ id: friendships.id });
  return updated.length > 0;
}
