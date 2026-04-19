import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { config } from '../config/env.js';

export const pgSql = postgres(config.DATABASE_URL, { max: 10 });
export const db = drizzle(pgSql);
