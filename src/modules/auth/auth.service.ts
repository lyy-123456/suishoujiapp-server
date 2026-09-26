import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit.service';
import { AppError } from '../../common/errors';
import { env } from '../../config/env';
import { DB, type Database } from '../../db/database.module';
import { appUser, userSession, userSetting } from '../../db/schema';
import type { ChangePasswordInput, LoginInput, LogoutInput, RegisterInput } from './auth.dto';
import { LoginThrottleService } from './login-throttle.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/** 请求上下文（用于审计与设备管理） */
export interface AuthContext {
  ip: string;
  userAgent: string;
  deviceName?: string;
}

/** 已通过鉴权的用户（由 AuthGuard 注入到请求上） */
export interface AuthUser {
  id: string;
  email: string | null;
  nickname: string;
  role: string;
  status: string;
  tokenVersion: number;
  /** 当前请求所用会话 id */
  sessionId: string;
}

export interface PublicUser {
  id: string;
  email: string | null;
  nickname: string;
  role: string;
  createdAt: Date;
}

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface SessionView {
  id: string;
  deviceName: string;
  ip: string;
  userAgent: string;
  createdAt: Date;
  lastUsedAt: Date;
  current: boolean;
}

const userColumns = {
  id: appUser.id,
  email: appUser.email,
  nickname: appUser.nickname,
  role: appUser.role,
  status: appUser.status,
  tokenVersion: appUser.tokenVersion,
  passwordHash: appUser.passwordHash,
  createdAt: appUser.createdAt,
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger('auth');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly throttle: LoginThrottleService,
    private readonly audit: AuditService,
  ) {}

  /* ────────────────────────── 注册 ────────────────────────── */

  async register(input: RegisterInput, ctx: AuthContext): Promise<AuthResult> {
    // 人少场景默认不开放注册：要么带对邀请码，要么在配置里显式打开
    if (!env().ALLOW_REGISTER) {
      const expected = env().INVITE_CODE;
      if (!expected || input.inviteCode !== expected) {
        this.audit.record({
          action: 'auth.register_denied',
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          detail: { email: input.email, reason: 'invite_code' },
        });
        throw AppError.forbidden('当前未开放注册，请使用邀请码');
      }
    }

    this.passwords.assertStrong(input.password, { email: input.email });

    const existing = await this.db
      .select({ id: appUser.id })
      .from(appUser)
      .where(eq(appUser.email, input.email))
      .limit(1);
    if (existing.length > 0) {
      throw AppError.conflict('该邮箱已注册，直接登录即可');
    }

    const passwordHash = await this.passwords.hash(input.password);
    const inserted = await this.db
      .insert(appUser)
      .values({
        email: input.email,
        passwordHash,
        nickname: input.nickname?.trim() || input.email.split('@')[0],
      })
      .returning(userColumns);

    const user = inserted[0];
    if (!user) throw new AppError(5000, '注册失败，请稍后再试', 500);

    // 每个用户一行设置，后续同步/备份直接读这一行
    await this.db.insert(userSetting).values({ userId: user.id, data: {} }).onConflictDoNothing();

    const result = await this.startSession(user, ctx);
    this.audit.record({
      actorId: user.id,
      action: 'auth.register',
      targetType: 'user',
      targetId: user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return result;
  }

  /* ────────────────────────── 登录 ────────────────────────── */

  async login(input: LoginInput, ctx: AuthContext): Promise<AuthResult> {
    const keys = [LoginThrottleService.accountKey(input.email), LoginThrottleService.ipKey(ctx.ip)];
    this.throttle.assertAllowed(keys);

    const rows = await this.db
      .select(userColumns)
      .from(appUser)
      .where(eq(appUser.email, input.email))
      .limit(1);
    const user = rows[0];

    // 用户不存在也要走一遍哈希校验，避免通过响应时间判断邮箱是否注册
    const passwordOk = user
      ? await this.passwords.verify(user.passwordHash, input.password)
      : await this.passwords
          .verify(
            '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$0000000000000000000000000000000000000000000',
            input.password,
          )
          .catch(() => false);

    if (!user || !passwordOk) {
      this.throttle.recordFailure(keys);
      this.audit.record({
        actorId: user?.id ?? null,
        action: 'auth.login_failed',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: { email: input.email, reason: user ? 'bad_password' : 'no_user' },
      });
      throw AppError.unauthorized('邮箱或密码不正确');
    }

    if (user.status !== 'active') {
      this.audit.record({
        actorId: user.id,
        action: 'auth.login_blocked',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: { status: user.status },
      });
      throw new AppError(2002, '账号已被停用，请联系管理员', 403);
    }

    this.throttle.reset(keys);
    await this.db
      .update(appUser)
      .set({ lastLoginAt: new Date(), lastLoginIp: ctx.ip })
      .where(eq(appUser.id, user.id));

    const result = await this.startSession(user, ctx);
    this.audit.record({
      actorId: user.id,
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return result;
  }

  /* ────────────────────────── 刷新令牌 ────────────────────────── */

  async refresh(refreshToken: string, ctx: AuthContext): Promise<AuthResult> {
    const hash = this.tokens.hashRefreshToken(refreshToken);

    // 先按当前令牌找；找不到再按"上一枚"找 —— 命中上一枚说明旧令牌被重放
    const found = await this.db
      .select({
        id: userSession.id,
        userId: userSession.userId,
        revokedAt: userSession.revokedAt,
        expiresAt: userSession.expiresAt,
        isPrevious: userSession.previousTokenHash,
      })
      .from(userSession)
      .where(or(eq(userSession.tokenHash, hash), eq(userSession.previousTokenHash, hash)))
      .limit(1);

    const session = found[0];
    if (!session) throw AppError.unauthorized('登录状态已失效，请重新登录');

    if (session.isPrevious === hash) {
      // 复用检测：旧刷新令牌被再次使用 → 视为泄露，吊销该用户全部会话
      // 同时 tokenVersion +1，让可能已泄露的 access token 也立刻失效
      await this.db
        .update(userSession)
        .set({ revokedAt: new Date() })
        .where(and(eq(userSession.userId, session.userId), isNull(userSession.revokedAt)));
      await this.db
        .update(appUser)
        .set({ tokenVersion: sql`${appUser.tokenVersion} + 1`, updatedAt: new Date() })
        .where(eq(appUser.id, session.userId));
      this.audit.record({
        actorId: session.userId,
        action: 'auth.refresh_reuse',
        targetType: 'session',
        targetId: session.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: { note: '检测到刷新令牌复用，已吊销全部会话' },
      });
      this.logger.warn(`检测到刷新令牌复用 userId=${session.userId}，已吊销全部会话`);
      throw AppError.unauthorized('登录状态异常，请重新登录');
    }

    if (session.revokedAt) throw AppError.unauthorized('登录状态已失效，请重新登录');
    if (session.expiresAt.getTime() <= Date.now()) throw AppError.unauthorized('登录已过期，请重新登录');

    const userRows = await this.db
      .select(userColumns)
      .from(appUser)
      .where(eq(appUser.id, session.userId))
      .limit(1);
    const user = userRows[0];
    if (!user) throw AppError.unauthorized('账号不存在');
    if (user.status !== 'active') throw new AppError(2002, '账号已被停用，请联系管理员', 403);

    // 轮换：同一会话换新令牌，旧令牌哈希留在 previousTokenHash 供复用检测
    const next = this.tokens.createRefreshToken();
    await this.db
      .update(userSession)
      .set({
        tokenHash: next.hash,
        previousTokenHash: hash,
        expiresAt: next.expiresAt,
        lastUsedAt: new Date(),
        ip: ctx.ip || undefined,
        userAgent: (ctx.userAgent || '').slice(0, 512) || undefined,
      })
      .where(eq(userSession.id, session.id));

    const access = await this.tokens.issueAccessToken({
      sub: user.id,
      sid: session.id,
      role: user.role,
      tv: user.tokenVersion,
    });

    return {
      user: toPublicUser(user),
      accessToken: access.token,
      refreshToken: next.token,
      expiresIn: access.expiresIn,
    };
  }

  /* ────────────────────────── 登出 ────────────────────────── */

  async logout(user: AuthUser, input: LogoutInput, ctx: AuthContext): Promise<{ revoked: number }> {
    if (input.allDevices) {
      const result = await this.db
        .update(userSession)
        .set({ revokedAt: new Date() })
        .where(and(eq(userSession.userId, user.id), isNull(userSession.revokedAt)))
        .returning({ id: userSession.id });
      // 同时 +1 tokenVersion，让已签发的 access token 也立刻失效
      await this.db
        .update(appUser)
        .set({ tokenVersion: user.tokenVersion + 1, updatedAt: new Date() })
        .where(eq(appUser.id, user.id));
      this.audit.record({
        actorId: user.id,
        action: 'auth.logout_all',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: { revoked: result.length },
      });
      return { revoked: result.length };
    }

    const hash = input.refreshToken ? this.tokens.hashRefreshToken(input.refreshToken) : '';
    const revoked = await this.db
      .update(userSession)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(userSession.userId, user.id),
          isNull(userSession.revokedAt),
          hash ? or(eq(userSession.tokenHash, hash), eq(userSession.previousTokenHash, hash))! : eq(userSession.id, user.sessionId),
        ),
      )
      .returning({ id: userSession.id });

    this.audit.record({
      actorId: user.id,
      action: 'auth.logout',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { revoked: revoked.length };
  }

  /* ────────────────────────── 改密 ────────────────────────── */

  async changePassword(user: AuthUser, input: ChangePasswordInput, ctx: AuthContext): Promise<AuthResult> {
    const rows = await this.db
      .select({ id: appUser.id, passwordHash: appUser.passwordHash })
      .from(appUser)
      .where(eq(appUser.id, user.id))
      .limit(1);
    const current = rows[0];
    if (!current) throw AppError.unauthorized('账号不存在');

    const ok = await this.passwords.verify(current.passwordHash, input.oldPassword);
    if (!ok) {
      this.audit.record({
        actorId: user.id,
        action: 'auth.password_change_failed',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw AppError.unauthorized('原密码不正确');
    }

    this.passwords.assertStrong(input.newPassword, { email: user.email ?? undefined });
    const passwordHash = await this.passwords.hash(input.newPassword);

    // 改密后：tokenVersion +1 让所有旧访问令牌失效，并吊销全部会话
    await this.db
      .update(appUser)
      .set({ passwordHash, tokenVersion: user.tokenVersion + 1, updatedAt: new Date() })
      .where(eq(appUser.id, user.id));
    await this.db
      .update(userSession)
      .set({ revokedAt: new Date() })
      .where(and(eq(userSession.userId, user.id), isNull(userSession.revokedAt)));

    // 给当前设备重新发一套令牌，避免用户改完密码就被踢下线
    const refreshed = await this.db
      .select(userColumns)
      .from(appUser)
      .where(eq(appUser.id, user.id))
      .limit(1);
    const result = await this.startSession(refreshed[0]!, ctx);

    this.audit.record({
      actorId: user.id,
      action: 'auth.password_changed',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return result;
  }

  /* ────────────────────────── 会话管理 ────────────────────────── */

  async listSessions(user: AuthUser): Promise<SessionView[]> {
    const rows = await this.db
      .select({
        id: userSession.id,
        deviceName: userSession.deviceName,
        ip: userSession.ip,
        userAgent: userSession.userAgent,
        createdAt: userSession.createdAt,
        lastUsedAt: userSession.lastUsedAt,
      })
      .from(userSession)
      .where(
        and(
          eq(userSession.userId, user.id),
          isNull(userSession.revokedAt),
          gt(userSession.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(userSession.lastUsedAt));

    return rows.map(row => ({ ...row, current: row.id === user.sessionId }));
  }

  async revokeSession(user: AuthUser, sessionId: string, ctx: AuthContext): Promise<void> {
    const result = await this.db
      .update(userSession)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(userSession.id, sessionId),
          // 归属校验：只能踢自己的设备
          eq(userSession.userId, user.id),
          isNull(userSession.revokedAt),
        ),
      )
      .returning({ id: userSession.id });

    if (result.length === 0) throw AppError.notFound('会话不存在或已失效');

    this.audit.record({
      actorId: user.id,
      action: 'auth.session_revoked',
      targetType: 'session',
      targetId: sessionId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  async me(user: AuthUser): Promise<PublicUser> {
    const rows = await this.db.select(userColumns).from(appUser).where(eq(appUser.id, user.id)).limit(1);
    const row = rows[0];
    if (!row) throw AppError.unauthorized('账号不存在');
    return toPublicUser(row);
  }

  /* ────────────────────────── 内部工具 ────────────────────────── */

  /** 建会话 + 发一套令牌 */
  private async startSession(
    user: { id: string; email: string | null; nickname: string; role: string; tokenVersion: number; createdAt: Date },
    ctx: AuthContext,
  ): Promise<AuthResult> {
    const refresh = this.tokens.createRefreshToken();
    const inserted = await this.db
      .insert(userSession)
      .values({
        userId: user.id,
        tokenHash: refresh.hash,
        expiresAt: refresh.expiresAt,
        deviceName: (ctx.deviceName ?? '').slice(0, 80),
        userAgent: (ctx.userAgent ?? '').slice(0, 512),
        ip: ctx.ip ?? '',
      })
      .returning({ id: userSession.id });

    const sessionId = inserted[0]!.id;
    const access = await this.tokens.issueAccessToken({
      sub: user.id,
      sid: sessionId,
      role: user.role,
      tv: user.tokenVersion,
    });

    return {
      user: toPublicUser(user),
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresIn: access.expiresIn,
    };
  }
}

function toPublicUser(user: {
  id: string;
  email: string | null;
  nickname: string;
  role: string;
  createdAt: Date;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    role: user.role,
    createdAt: user.createdAt,
  };
}
