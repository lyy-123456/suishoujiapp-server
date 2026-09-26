import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/errors';

interface Bucket {
  count: number;
  windowStart: number;
  lockedUntil: number;
}

const ACCOUNT_PREFIX = 'acct:';
const IP_PREFIX = 'ip:';

/**
 * 登录失败限流（进程内实现）。
 *
 * 单实例部署下不需要 Redis：状态放内存即可，重启丢失只是"重置计数"，可接受。
 * 将来多实例或需要严格限制时，把这里换成 Redis 计数即可（接口不变）。
 *
 * 规则：
 *  - 单账号：15 分钟内失败 5 次 → 锁 15 分钟
 *  - 单 IP：1 小时内失败 20 次 → 锁 1 小时
 */
@Injectable()
export class LoginThrottleService {
  private readonly logger = new Logger('throttle');
  private readonly buckets = new Map<string, Bucket>();

  private readonly accountRule = { limit: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 };
  private readonly ipRule = { limit: 20, windowMs: 60 * 60_000, lockMs: 60 * 60_000 };

  static accountKey(email: string): string {
    return `${ACCOUNT_PREFIX}${email.toLowerCase()}`;
  }

  static ipKey(ip: string): string {
    return `${IP_PREFIX}${ip || 'unknown'}`;
  }

  private ruleFor(key: string) {
    return key.startsWith(IP_PREFIX) ? this.ipRule : this.accountRule;
  }

  /** 已锁定则直接抛出（消息里带剩余分钟，便于用户理解） */
  assertAllowed(keys: string[]): void {
    const now = Date.now();
    for (const key of keys) {
      const bucket = this.buckets.get(key);
      if (bucket && bucket.lockedUntil > now) {
        const minutes = Math.ceil((bucket.lockedUntil - now) / 60_000);
        throw AppError.accountLocked(`尝试次数过多，请 ${minutes} 分钟后再试`);
      }
    }
  }

  recordFailure(keys: string[]): void {
    const now = Date.now();
    for (const key of keys) {
      const rule = this.ruleFor(key);
      const bucket = this.buckets.get(key);
      if (!bucket || now - bucket.windowStart > rule.windowMs) {
        this.buckets.set(key, { count: 1, windowStart: now, lockedUntil: 0 });
        continue;
      }
      bucket.count += 1;
      if (bucket.count >= rule.limit) {
        bucket.lockedUntil = now + rule.lockMs;
        bucket.count = 0;
        bucket.windowStart = now;
        this.logger.warn(`触发登录限流 key=${key}，锁定 ${Math.round(rule.lockMs / 60_000)} 分钟`);
      }
    }
    this.sweep(now);
  }

  /** 登录成功后清掉计数 */
  reset(keys: string[]): void {
    for (const key of keys) this.buckets.delete(key);
  }

  /** 惰性清理：只清既过期又没锁定的桶，避免 Map 无限增长 */
  private sweep(now: number): void {
    if (this.buckets.size < 500) return;
    for (const [key, bucket] of this.buckets) {
      const rule = this.ruleFor(key);
      if (bucket.lockedUntil <= now && now - bucket.windowStart > rule.windowMs) {
        this.buckets.delete(key);
      }
    }
  }
}
