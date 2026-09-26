import 'dotenv/config';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDb, db } from './client';

/**
 * 执行迁移：读取 drizzle/ 目录下的 SQL 文件并应用到数据库。
 * 用法：npm run db:migrate
 */
async function main(): Promise<void> {
  const folder = path.resolve(process.cwd(), 'drizzle');
  console.log(`[migrate] 从 ${folder} 应用迁移…`);
  await migrate(db(), { migrationsFolder: folder });
  console.log('[migrate] 完成');
  await closeDb();
}

main().catch(async err => {
  console.error('[migrate] 失败：', err);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
