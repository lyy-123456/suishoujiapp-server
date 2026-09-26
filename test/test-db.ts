import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { Pool } from 'pg';
import * as schema from '../src/db/schema';

export interface TestDb {
  db: NodePgDatabase<typeof schema>;
  pool: unknown;
  /** 仅 pg-mem 模式可用（用于直接查表断言）；真实 Postgres 模式下为 null */
  mem: IMemoryDb | null;
  mode: 'pg-mem' | 'postgres';
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
 */
function patchPgMem(pg: PgLikeClient): void {
  const proto = pg.prototype as unknown as {
    query: (config?: unknown, values?: unknown, callback?: unknown) => unknown;
  };
  const original = proto.query;

  const toArrayRows = (rows: unknown): unknown[] =>
    ((rows as unknown[]) ?? []).map(row => (Array.isArray(row) ? row : Object.values(row as object)));

  proto.query = function patched(this: unknown, config?: unknown, values?: unknown, callback?: unknown) {
    const cfg: Record<string, unknown> =
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

/**
 * 准备测试数据库：
 * - 默认用 pg-mem（内存版 Postgres）：本地无需 Docker/数据库即可跑端到端测试
 * - 设置了 `TEST_DATABASE_URL` 时用**真实 Postgres**（CI 里用 service 容器跑同一套用例）
 *
 * 两种模式都应用**真实的迁移 SQL**，所以测的是生产同款结构。
 */
export async function createTestDb(): Promise<TestDb> {
  const migrationsFolder = path.resolve(process.cwd(), 'drizzle');
  const realUrl = process.env.TEST_DATABASE_URL;

  if (realUrl) {
    const pool = new Pool({ connectionString: realUrl, max: 5 });
    // 每次从干净结构开始，避免用例互相污染
    await pool.query('drop schema if exists public cascade; create schema public;');
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder });
    return {
      db,
      pool,
      mem: null,
      mode: 'postgres',
      close: async () => {
        await pool.end();
      },
    };
  }

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
  // pg-mem 的 Pool 与 Client 是同一个类（MemPg），补丁打在 Client 上即可
  patchPgMem(pg.Client as unknown as PgLikeClient);

  const pool = new pg.Pool();
  const db = drizzle(pool as never, { schema });
  await migrate(db, { migrationsFolder });

  return {
    db,
    pool,
    mem,
    mode: 'pg-mem',
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
