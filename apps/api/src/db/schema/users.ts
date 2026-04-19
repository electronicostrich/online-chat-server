import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Maps to data-model.md §4.1. username_canonical stores the normalized form
// (trim + NFC + whitespace-collapse + lowercase) so case-insensitive uniqueness
// can be enforced with a plain unique index.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  emailCanonical: text('email_canonical').notNull().unique(),
  username: text('username').notNull(),
  usernameCanonical: text('username_canonical').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  status: text('status', { enum: ['active', 'deleted'] })
    .notNull()
    .default('active'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
