import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { friendships } from '../../db/schema/friendships.js';
import { roomMemberships } from '../../db/schema/room-memberships.js';

// AC-PRES-01..04 fan-out target computation. Returns the set of
// userIds who are permitted to observe `subjectUserId`'s presence, per
// permissions-matrix.md §4 "View presence of friend / room member".
// Self is always included so the subject's other tabs reflect their
// own state.
//
// Observers = { self } ∪ { active friends } ∪ { other active members
// of rooms the subject is still an active member of }. A user who
// appears in more than one bucket is emitted once.
export async function listPresenceObserverIds(
  subjectUserId: string,
): Promise<Set<string>> {
  const ids = new Set<string>([subjectUserId]);

  const friendRows = await db
    .select({
      userLowId: friendships.userLowId,
      userHighId: friendships.userHighId,
    })
    .from(friendships)
    .where(
      and(
        isNull(friendships.endedAt),
        or(
          eq(friendships.userLowId, subjectUserId),
          eq(friendships.userHighId, subjectUserId),
        ),
      ),
    );
  for (const row of friendRows) {
    const other =
      row.userLowId === subjectUserId ? row.userHighId : row.userLowId;
    ids.add(other);
  }

  // Room co-members: rooms the subject is still an active member of,
  // then the other active members of those rooms. A single `IN (...)`
  // query instead of one round-trip per room — a user in hundreds of
  // rooms would otherwise drive every presence publish into hundreds
  // of sequential DB calls on the sweep hot path.
  const subjectRoomRows = await db
    .select({ roomChatId: roomMemberships.roomChatId })
    .from(roomMemberships)
    .where(
      and(
        eq(roomMemberships.userId, subjectUserId),
        isNull(roomMemberships.leftAt),
      ),
    );
  const roomChatIds = subjectRoomRows.map((row) => row.roomChatId);
  if (roomChatIds.length > 0) {
    const coMembers = await db
      .select({ userId: roomMemberships.userId })
      .from(roomMemberships)
      .where(
        and(
          inArray(roomMemberships.roomChatId, roomChatIds),
          isNull(roomMemberships.leftAt),
        ),
      );
    for (const { userId } of coMembers) ids.add(userId);
  }

  return ids;
}
