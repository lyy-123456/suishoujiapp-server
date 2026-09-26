import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../config/env';
import * as schema from './schema';

let pool: Pool | null = null;
let database: NodePgDatabase<typeof schema> | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: env().DATABASE_URL,
      max: env().DB_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // 小机器上避免长事务占着连接
      statement_timeout: 15_000,
      query_timeout: 15_000,
    });
  }
  return pool;
}

export function db(): NodePgDatabase<typeof schema> {
  if (!database) {
    database = drizzle(getPool(), { schema });
  }
  return database;
}

/** 就绪探针：能跑通一条最简查询即视为可用 */
export async function pingDb(): Promise<boolean> {
  try {
    const result = await getPool().query('select 1 as ok');
    return result.rows.length === 1;
  } catch {
    return false;
  }
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    database = null;
  }
}

export { schema };
