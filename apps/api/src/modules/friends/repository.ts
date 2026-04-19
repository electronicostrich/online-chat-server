import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users, type UserRow } from '../../db/schema/users.js';
import {
  friendRequests,
  type FriendRequestRow,
} from '../../db/schema/friend-requests.js';
import { userBlocks } from '../../db/schema/user-blocks.js';
import { friendships } from '../../db/schema/friendships.js';

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
