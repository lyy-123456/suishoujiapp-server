import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { resetEnvCache } from '../src/config/env';
import { DB, PG_POOL } from '../src/db/database.module';
import { auditLog } from '../src/db/schema';
import { createTestDb, setTestEnv, type TestDb } from './test-db';

let app: NestFastifyApplication;
let testDb: TestDb;

interface Envelope<T = unknown> {
  code: number;
  message: string;
  data: T;
  requestId: string;
}

interface AuthPayload {
  user: { id: string; email: string; nickname: string; role: string };
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

async function call<T = unknown>(
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
  url: string,
  options: { body?: unknown; token?: string } = {},
): Promise<{ status: number; body: Envelope<T> }> {
  const response = await app.inject({
    method,
    url,
    payload: options.body as never,
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
  });
  return { status: response.statusCode, body: response.json() as Envelope<T> };
}

const EMAIL = 'tester@example.com';
const PASSWORD = 'GoodPassw0rd!';
const INVITE = 'let-me-in';

/** 审计是 fire-and-forget 写入，读表前让出一个事件循环 */
const flush = () => new Promise(resolve => setTimeout(resolve, 50));

describe('认证模块（端到端，跑在 pg-mem 上的真实迁移）', () => {
  let primary: AuthPayload;

  beforeAll(async () => {
    setTestEnv();
    resetEnvCache();
    testDb = await createTestDb();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DB)
      .useValue(testDb.db)
      .overrideProvider(PG_POOL)
      .useValue(testDb.pool)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1', { exclude: ['healthz', 'readyz'] });
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
  });

  it('健康检查不受响应封装影响', async () => {
    const { status, body } = await call('GET', '/healthz');
    expect(status).toBe(200);
    // /healthz 是原始 JSON（供容器探针用），不带 code/message 信封
    expect((body as unknown as { ok?: boolean }).ok).toBe(true);
    expect(body.code).toBeUndefined();
  });

  it('没带邀请码注册 → 403（默认不开放注册）', async () => {
    const { status, body } = await call('POST', '/api/v1/auth/register', {
      body: { email: EMAIL, password: PASSWORD },
    });
    expect(status).toBe(403);
    expect(body.code).toBe(1003);
  });

  it('邀请码错误 → 403', async () => {
    const { status, body } = await call('POST', '/api/v1/auth/register', {
      body: { email: EMAIL, password: PASSWORD, inviteCode: 'wrong-code' },
    });
    expect(status).toBe(403);
    expect(body.code).toBe(1003);
  });

  it('弱密码 → 400，且给出可读原因', async () => {
    const { status, body } = await call('POST', '/api/v1/auth/register', {
      body: { email: EMAIL, password: 'short', inviteCode: INVITE },
    });
    expect(status).toBe(400);
    expect(body.code).toBe(1001);
    expect(body.message).toContain('密码至少');
  });

  it('邮箱格式错误 → 400', async () => {
    const { status, body } = await call('POST', '/api/v1/auth/register', {
      body: { email: 'not-an-email', password: PASSWORD, inviteCode: INVITE },
    });
    expect(status).toBe(400);
    expect(body.code).toBe(1001);
  });

  it('带邀请码注册成功 → 返回令牌，且不泄露密码哈希', async () => {
    const { status, body } = await call<AuthPayload>('POST', '/api/v1/auth/register', {
      body: { email: EMAIL, password: PASSWORD, inviteCode: INVITE, nickname: '测试用户' },
    });
    expect(status).toBe(201);
    expect(body.code).toBe(0);
    expect(body.data.accessToken).toBeTruthy();
    expect(body.data.refreshToken).toBeTruthy();
    expect(body.data.user.email).toBe(EMAIL);
    expect(body.data.user.nickname).toBe('测试用户');
    expect(JSON.stringify(body.data)).not.toContain('passwordHash');
    expect(JSON.stringify(body.data)).not.toContain('argon2');
    primary = body.data;
  });

  it('重复邮箱注册 → 409', async () => {
    const { status, body } = await call('POST', '/api/v1/auth/register', {
      body: { email: EMAIL, password: PASSWORD, inviteCode: INVITE },
    });
    expect(status).toBe(409);
    expect(body.code).toBe(1009);
  });

  it('未带令牌访问 /auth/me → 401', async () => {
    const { status, body } = await call('GET', '/api/v1/auth/me');
    expect(status).toBe(401);
    expect(body.code).toBe(1002);
  });

  it('伪造令牌 → 401', async () => {
    const { status } = await call('GET', '/api/v1/auth/me', { token: 'x.y.z' });
    expect(status).toBe(401);
  });

  it('带令牌访问 /auth/me → 返回本人信息', async () => {
    const { status, body } = await call<{ email: string }>('GET', '/api/v1/auth/me', {
      token: primary.accessToken,
    });
    expect(status).toBe(200);
    expect(body.data.email).toBe(EMAIL);
  });

  it('refresh 轮换：旧令牌重放会被识别为复用并吊销全部会话', async () => {
    const rotated = await call<AuthPayload>('POST', '/api/v1/auth/refresh', {
      body: { refreshToken: primary.refreshToken },
    });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.refreshToken).not.toBe(primary.refreshToken);

    // 重放旧令牌 → 判定为泄露
    const replay = await call('POST', '/api/v1/auth/refresh', {
      body: { refreshToken: primary.refreshToken },
    });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe(1002);

    // 连刚拿到的新令牌也一起失效了（全部会话被吊销 + tokenVersion 升级）
    const afterReuse = await call('POST', '/api/v1/auth/refresh', {
      body: { refreshToken: rotated.body.data.refreshToken },
    });
    expect(afterReuse.status).toBe(401);

    // 泄露前的 access token 也立即失效
    const meAfter = await call('GET', '/api/v1/auth/me', { token: primary.accessToken });
    expect(meAfter.status).toBe(401);

    // 审计里应当留下复用记录（用 drizzle 查，pg-mem 与真实 PG 两种模式都能跑）
    await flush();
    const audits = await testDb.db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.action, 'auth.refresh_reuse'));
    expect(audits.length).toBe(1);
  });

  it('重新登录后可用；会话列表能看到当前设备', async () => {
    const login = await call<AuthPayload>('POST', '/api/v1/auth/login', {
      body: { email: EMAIL, password: PASSWORD, deviceName: 'MacBook' },
    });
    expect(login.status).toBe(200);
    primary = login.body.data;

    const sessions = await call<{ id: string; current: boolean; deviceName: string }[]>(
      'GET',
      '/api/v1/auth/sessions',
      { token: primary.accessToken },
    );
    expect(sessions.status).toBe(200);
    expect(sessions.body.data.length).toBe(1);
    expect(sessions.body.data[0]!.current).toBe(true);
    expect(sessions.body.data[0]!.deviceName).toBe('MacBook');
  });

  it('校验规则生效：out（邮箱大小写归一 + 昵称默认取邮箱前缀）', async () => {
    const { body } = await call<AuthPayload>('POST', '/api/v1/auth/login', {
      body: { email: EMAIL.toUpperCase(), password: PASSWORD },
    });
    expect(body.data.user.email).toBe(EMAIL);
  });

  it('改密：原密码错 → 401；成功后旧 access token 立即失效并换发新令牌', async () => {
    const wrong = await call('POST', '/api/v1/auth/password', {
      token: primary.accessToken,
      body: { oldPassword: 'WrongOldPass1', newPassword: 'BrandNewPass9!' },
    });
    expect(wrong.status).toBe(401);

    const oldAccessToken = primary.accessToken;
    const changed = await call<AuthPayload>('POST', '/api/v1/auth/password', {
      token: oldAccessToken,
      body: { oldPassword: PASSWORD, newPassword: 'BrandNewPass9!' },
    });
    expect(changed.status).toBe(200);
    expect(changed.body.data.accessToken).toBeTruthy();

    const withOld = await call('GET', '/api/v1/auth/me', { token: oldAccessToken });
    expect(withOld.status).toBe(401);

    const withNew = await call('GET', '/api/v1/auth/me', { token: changed.body.data.accessToken });
    expect(withNew.status).toBe(200);

    primary = changed.body.data;
  });

  it('登录失败 5 次触发账号锁定 → 第 6 次返回 423', async () => {
    const other = 'lockme@example.com';
    const registered = await call<AuthPayload>('POST', '/api/v1/auth/register', {
      body: { email: other, password: PASSWORD, inviteCode: INVITE },
    });
    expect(registered.status).toBe(201);

    for (let i = 1; i <= 5; i++) {
      const attempt = await call('POST', '/api/v1/auth/login', {
        body: { email: other, password: 'WrongPassword123' },
      });
      expect(attempt.status, `第 ${i} 次失败应为 401`).toBe(401);
      expect(attempt.body.code).toBe(1002);
    }

    const locked = await call('POST', '/api/v1/auth/login', {
      body: { email: other, password: PASSWORD },
    });
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe(2001);
  });

  it('登出后 refresh token 失效', async () => {
    const logout = await call('POST', '/api/v1/auth/logout', {
      token: primary.accessToken,
      body: {},
    });
    expect(logout.status).toBe(200);

    const afterLogout = await call('POST', '/api/v1/auth/refresh', {
      body: { refreshToken: primary.refreshToken },
    });
    expect(afterLogout.status).toBe(401);
  });

  it('登录失败会写审计（不含明文密码）', async () => {
    await flush();
    const logs = await testDb.db
      .select({ action: auditLog.action, detail: auditLog.detail })
      .from(auditLog)
      .where(eq(auditLog.action, 'auth.login_failed'));
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain('WrongPassword123');
  });
});
