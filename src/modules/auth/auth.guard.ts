import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../common/errors';
import { DB, type Database } from '../../db/database.module';
import { appUser } from '../../db/schema';
import type { AuthUser } from './auth.service';
import { TokenService, type AccessTokenPayload } from './token.service';

export interface AuthedRequest extends FastifyRequest {
  user?: AuthUser;
}

/**
 * Bearer 令牌鉴权。
 * 除签名校验外，还会核对：
 *  - 账号状态（disabled 直接 403）
 *  - token_version（改密/踢下线后旧令牌立即失效）
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.headers['authorization'];
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw AppError.unauthorized('请先登录');

    let payload: AccessTokenPayload;
    try {
      payload = await this.tokens.verifyAccessToken(token);
    } catch {
      // 过期或签名不对，都让客户端去走 refresh
      throw AppError.unauthorized('登录状态已失效，请重新登录');
    }

    const rows = await this.db
      .select({
        id: appUser.id,
        email: appUser.email,
        nickname: appUser.nickname,
        role: appUser.role,
        status: appUser.status,
        tokenVersion: appUser.tokenVersion,
      })
      .from(appUser)
      .where(eq(appUser.id, payload.sub))
      .limit(1);

    const user = rows[0];
    if (!user) throw AppError.unauthorized('账号不存在');
    if (user.status !== 'active') throw new AppError(2002, '账号已被停用，请联系管理员', 403);
    if (user.tokenVersion !== payload.tv) throw AppError.unauthorized('登录状态已失效，请重新登录');

    request.user = { ...user, sessionId: payload.sid };
    return true;
  }
}
