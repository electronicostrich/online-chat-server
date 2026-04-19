import { and, eq, isNull, ne } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users, type UserRow } from '../../db/schema/users.js';
import {
  sessions,
  type NewSessionRow,
  type SessionRow,
} from '../../db/schema/sessions.js';

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
