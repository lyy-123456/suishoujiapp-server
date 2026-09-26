import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit 配置。
 * 注意：`generate` 是离线的（只比对 schema 与快照），因此本地没连数据库也能生成迁移 SQL。
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/suishouji',
  },
});
