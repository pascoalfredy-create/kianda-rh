import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './schema.js';

export * from './schema.js';
export { schema };
export type Db = NodePgDatabase<typeof schema>;

let instance: { db: Db; pool: pg.Pool } | undefined;
const requestScope = new AsyncLocalStorage<Db>();

/**
 * Ligação ao PostgreSQL.
 * - Em Node (servidor, testes, scripts): um pool único por processo.
 * - Em Cloudflare Workers: uma ligação por pedido, aberta por `withRequestDb` — o runtime proíbe reutilizar sockets entre pedidos.
 */
export function getDb(connectionString = process.env.DATABASE_URL): Db {
  const scoped = requestScope.getStore();
  if (scoped) return scoped;
  if (!connectionString) throw new Error('DATABASE_URL não definida');
  if (!instance) {
    // DATABASE_CA_CERT (opcional): certificado CA do fornecedor em PEM (só se for privada) → TLS com verificação completa (CI / scripts).
    const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n');
    const pool = new pg.Pool({ connectionString, max: 10, ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}) });
    instance = { pool, db: drizzle(pool, { schema }) };
  }
  return instance.db;
}

/** Executa `fn` com uma ligação própria (aberta só se for usada) e fecha-a no fim. */
export async function withRequestDb<T>(connectionString: string, fn: () => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    return await requestScope.run(drizzle(pool, { schema }), fn);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function closeDb(): Promise<void> {
  await instance?.pool.end();
  instance = undefined;
}
export * from './password.js';

/** Operadores SQL re-exportados: as apps usam a mesma instância do drizzle-orm que o schema (evita tipos duplicados). */
export { and, asc, desc, eq, gt, gte, inArray, isNull, like, lt, lte, ne, or, sql } from 'drizzle-orm';

/**
 * Executa o trabalho de um pedido de empresa com segurança ao nível da linha (RLS):
 * uma transacção com o papel kianda_app e a empresa fixada (SET LOCAL — compatível com o pooling em modo
 * transacção do Hyperdrive). Dentro, getDb() devolve a transacção; mesmo que uma consulta esqueça o filtro
 * por empresa, o Postgres só devolve e só aceita linhas desta empresa.
 */
export async function withTenant<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${companyId}, true)`);
    await tx.execute(sql`set local role kianda_app`);
    return requestScope.run(tx as unknown as Db, fn);
  });
}
