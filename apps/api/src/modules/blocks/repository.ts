import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users, type UserRow } from '../../db/schema/users.js';
import { userBlocks, type UserBlockRow } from '../../db/schema/user-blocks.js';

export async function findUserById(
  userId: string,
): Promise<UserRow | undefined> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.status, 'active')))
    .limit(1);
  return rows[0];
}

export async function findActiveBlock(
  blockerUserId: string,
  blockedUserId: string,
): Promise<UserBlockRow | undefined> {
  const rows = await db
    .select()
    .from(userBlocks)
    .where(
      and(
        eq(userBlocks.blockerUserId, blockerUserId),
        eq(userBlocks.blockedUserId, blockedUserId),
        isNull(userBlocks.removedAt),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function insertActiveBlock(
  blockerUserId: string,
  blockedUserId: string,
): Promise<UserBlockRow> {
  const [row] = await db
    .insert(userBlocks)
    .values({ blockerUserId, blockedUserId })
    .returning();
  if (row === undefined) {
    throw new Error('insertActiveBlock returned no row');
  }
  return row;
}
