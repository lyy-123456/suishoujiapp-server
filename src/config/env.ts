import { z } from 'zod';

/** "true"/"1" 之类字符串也要能正确解析（环境变量都是字符串） */
const boolFromString = z
  .union([z.boolean(), z.string()])
  .transform(v => v === true || v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** 例：postgres://suishouji:***@postgres:5432/suishouji */
  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().positive().max(50).default(10),

  /** 访问令牌签名密钥，至少 32 字符（openssl rand -base64 48） */
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(365).default(30),
  /** 刷新令牌哈希的附加盐（泄库后也无法直接重放），至少 16 字符 */
  REFRESH_TOKEN_PEPPER: z.string().min(16),

  /** 是否开放注册；关闭时仅能凭邀请码注册 */
  ALLOW_REGISTER: boolFromString.default(false),
  INVITE_CODE: z.string().default(''),

  /** 允许跨域的来源，逗号分隔；留空表示不启用 CORS */
  CORS_ORIGINS: z.string().default(''),

  /** 对象存储（阶段 2 图片上云用，先留空即可启动） */
  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default(''),
  S3_BUCKET: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),

  /** 高德 Web 服务 key（仅服务端持有，供 /geo 代理使用） */
  AMAP_KEY: z.string().default(''),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

/**
 * 读取并校验环境变量。
 * 缺项/格式错直接抛错让进程起不来 —— 避免"以为配好了其实没配"的线上事故。
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(i => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`环境变量校验失败：\n${issues}\n请对照 .env.example 补齐后重启。`);
  }
  cached = parsed.data;
  return cached;
}

export function env(): AppEnv {
  return loadEnv();
}

export function isProduction(): boolean {
  return env().NODE_ENV === 'production';
}

/** 解析 CORS 白名单 */
export function corsOrigins(): string[] {
  return env()
    .CORS_ORIGINS.split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/** 仅供测试使用：清掉缓存以便用不同环境变量重新加载 */
export function resetEnvCache(): void {
  cached = null;
}
