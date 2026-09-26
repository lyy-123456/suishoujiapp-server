import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import * as schema from '../src/db/schema';

export interface TestDb {
  db: NodePgDatabase<typeof schema>;
  pool: unknown;
  mem: IMemoryDb;
  close: () => Promise<void>;
}

interface PgLikeClient {
  prototype: { query: (config?: unknown, values?: unknown, callback?: unknown) => unknown };
}

/**
 * pg-mem 适配补丁（不然 drizzle 完全跑不起来）：
 *
 * 1. `types.getTypeParser`：drizzle 会在查询配置里带上它，pg-mem 见到就抛 NotSupported → 剥掉。
 * 2. `rowMode: 'array'`：drizzle 的 pg 驱动**总是**用数组行 + 下标映射字段，pg-mem 不支持 → 剥掉，
 *    并把 pg-mem 返回的对象行按「列顺序」转成数组（JS 对象键序 = SQL 投影顺序，已验证）。
 *
 * 这样测试跑的是**真实的迁移 SQL + 真实的 drizzle 查询**，只是数据库换成了内存实现。
 */
function patchPgMem(pg: PgLikeClient): void {
  const proto = pg.prototype as unknown as {
    query: (config?: unknown, values?: unknown, callback?: unknown) => unknown;
  };
  const original = proto.query;

  const toArrayRows = (rows: unknown): unknown[] =>
    ((rows as unknown[]) ?? []).map(row => (Array.isArray(row) ? row : Object.values(row as object)));

  proto.query = function patched(this: unknown, config?: unknown, values?: unknown, callback?: unknown) {
    let cfg: Record<string, unknown> =
      typeof config === 'string' ? { text: config } : { ...(config as Record<string, unknown>) };
    const wantsArray = cfg.rowMode === 'array';
    delete cfg.types;
    delete cfg.rowMode;

    let cb = callback as ((err: unknown, result: unknown) => void) | undefined;
    let vals = values;
    if (typeof values === 'function') {
      cb = values as (err: unknown, result: unknown) => void;
      vals = undefined;
    }

    if (typeof cb === 'function') {
      return original.call(this, cfg, vals, (err: unknown, result: unknown) => {
        const patchedResult =
          !err && result && wantsArray
            ? { ...(result as Record<string, unknown>), rows: toArrayRows((result as { rows?: unknown }).rows) }
            : result;
        cb?.(err, patchedResult);
      });
    }

    const result = original.call(this, cfg, vals) as { then?: unknown } | undefined;
    if (result && typeof result.then === 'function') {
      return (result as Promise<Record<string, unknown>>).then(r =>
        wantsArray && r ? { ...r, rows: toArrayRows(r.rows) } : r,
      );
    }
    return wantsArray && result
      ? { ...(result as Record<string, unknown>), rows: toArrayRows((result as { rows?: unknown }).rows) }
      : result;
  };
}

/** 起一个内存版 Postgres 并应用真实迁移（本地无 Docker/无数据库时也能跑端到端测试） */
export async function createTestDb(): Promise<TestDb> {
  const mem = newDb({ autoCreateForeignKeyIndices: true });

  mem.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });
  mem.public.registerFunction({
    name: 'version',
    returns: DataType.text,
    implementation: () => 'PostgreSQL 16.0 (pg-mem)',
  });

  const pg = mem.adapters.createPg();
  // 注意：pg-mem 的 Pool 与 Client 是同一个类（MemPg），补丁打在 Client 上即可
  patchPgMem(pg.Client as unknown as PgLikeClient);

  const pool = new pg.Pool();
  const db = drizzle(pool as never, { schema });
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'drizzle') });

  return {
    db,
    pool,
    mem,
    close: async () => {
      await pool.end();
    },
  };
}

/** 测试用环境变量：必须在创建 Nest 应用之前调用 */
export function setTestEnv(overrides: Record<string, string> = {}): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:5432/test';
  process.env.JWT_SECRET = 'test-secret-must-be-long-enough-1234567890';
  process.env.REFRESH_TOKEN_PEPPER = 'test-pepper-1234567890';
  process.env.ACCESS_TOKEN_TTL = '15m';
  process.env.REFRESH_TOKEN_TTL_DAYS = '30';
  process.env.ALLOW_REGISTER = 'false';
  process.env.INVITE_CODE = 'let-me-in';
  process.env.LOG_LEVEL = 'fatal';
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
}
