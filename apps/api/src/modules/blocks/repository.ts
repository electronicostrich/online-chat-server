import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users, type UserRow } from '../../db/schema/users.js';
import { userBlocks } from '../../db/schema/user-blocks.js';

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

// Inserts a new active block row. Uses `ON CONFLICT DO NOTHING` against
// the partial unique index on `(blocker, blocked) WHERE removed_at IS NULL`
// so concurrent callers can't race through the service layer's pre-check
// into a unique-violation 500. Returning the inserted row count is
// sufficient; callers treat both 0 and 1 as success.
export async function insertActiveBlockIgnoreConflict(
  blockerUserId: string,
  blockedUserId: string,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO ${userBlocks} (blocker_user_id, blocked_user_id)
    VALUES (${blockerUserId}, ${blockedUserId})
    ON CONFLICT (blocker_user_id, blocked_user_id)
      WHERE removed_at IS NULL
      DO NOTHING
  `);
}
