import { Global, Module, type Provider } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { getPool } from './client';
import * as schema from './schema';

/** 注入令牌：业务代码用 @Inject(DB) 拿数据库，测试里可直接 overrideProvider 换成 pg-mem */
export const DB = Symbol('DB_CONNECTION');
export const PG_POOL = Symbol('PG_POOL');

export type Database = NodePgDatabase<typeof schema>;

const providers: Provider[] = [
  {
    provide: PG_POOL,
    useFactory: (): Pool => getPool(),
  },
  {
    provide: DB,
    useFactory: (): Database => drizzle(getPool(), { schema }),
  },
];

/** 全局数据库模块：其他模块无需重复 import */
@Global()
@Module({
  providers,
  exports: [DB, PG_POOL],
})
export class DatabaseModule {}
