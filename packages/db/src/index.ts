import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export * from './schema.js';
export { schema };
export type Db = NodePgDatabase<typeof schema>;

let instance: { db: Db; pool: pg.Pool } | undefined;

/** Ligação única por processo ao PostgreSQL. */
export function getDb(connectionString = process.env.DATABASE_URL): Db {
  if (!connectionString) throw new Error('DATABASE_URL não definida');
  if (!instance) {
    const pool = new pg.Pool({ connectionString, max: 10 });
    instance = { pool, db: drizzle(pool, { schema }) };
  }
  return instance.db;
}

export async function closeDb(): Promise<void> {
  await instance?.pool.end();
  instance = undefined;
}
