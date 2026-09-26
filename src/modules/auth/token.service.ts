import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env';

export interface AccessTokenPayload {
  /** 用户 id */
  sub: string;
  /** 会话 id（对应 user_session.id） */
  sid: string;
  /** 角色 */
  role: string;
  /** 用户 token_version：改密/踢下线后旧令牌立即失效 */
  tv: number;
}

export interface IssuedRefreshToken {
  token: string;
  /** 只把哈希存库 */
  hash: string;
  expiresAt: Date;
}

/** '15m' / '900s' / '2h' / '7d' → 秒 */
export function parseDurationToSeconds(value: string, fallbackSeconds: number): number {
  const match = /^(\d+)\s*([smhd])?$/i.exec(value.trim());
  if (!match) return fallbackSeconds;
  const amount = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const factor = unit === 'm' ? 60 : unit === 'h' ? 3600 : unit === 'd' ? 86400 : 1;
  return amount * factor;
}

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  accessTokenTtlSeconds(): number {
    return parseDurationToSeconds(env().ACCESS_TOKEN_TTL, 900);
  }

  refreshTokenTtlMs(): number {
    return env().REFRESH_TOKEN_TTL_DAYS * 86400_000;
  }

  async issueAccessToken(payload: AccessTokenPayload): Promise<{ token: string; expiresIn: number }> {
    const token = await this.jwt.signAsync(payload, {
      expiresIn: this.accessTokenTtlSeconds(),
    });
    return { token, expiresIn: this.accessTokenTtlSeconds() };
  }

  /** 校验失败会抛异常，由调用方转成 401 */
  verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token);
  }

  /** 刷新令牌是**不透明随机串**（不是 JWT）：库被拖走也无法直接重放 */
  createRefreshToken(): IssuedRefreshToken {
    const token = randomBytes(32).toString('base64url');
    return {
      token,
      hash: this.hashRefreshToken(token),
      expiresAt: new Date(Date.now() + this.refreshTokenTtlMs()),
    };
  }

  /** 哈希里混入服务端 pepper：即使数据库泄露，攻击者也无法离线比对 */
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(`${env().REFRESH_TOKEN_PEPPER}:${token}`).digest('hex');
  }
}
