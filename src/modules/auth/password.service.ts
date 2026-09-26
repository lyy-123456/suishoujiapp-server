import { Injectable } from '@nestjs/common';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import { AppError } from '../../common/errors';

/**
 * Argon2id 参数：OWASP 推荐档位（m=19MiB, t=2, p=1）。
 * 2C2G 上单次哈希约占 19MB，并发登录也不会把内存打爆；想更强可调到 46MiB/t=1。
 */
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

const MIN_LENGTH = 10;
const MAX_LENGTH = 128;

/** 极小的常见弱口令黑名单（够用即可，不做完整字典） */
const WEAK_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '1234567890',
  '12345678901',
  '123456789012',
  'qwertyuiop',
  '1111111111',
  'admin123456',
  'iloveyou123',
  'suishouji123',
  'a1234567890',
]);

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return hash(plain, ARGON2_OPTIONS);
  }

  /** 校验失败一律返回 false（不区分"哈希坏了"和"密码错了"，避免信息泄露） */
  async verify(passwordHash: string, plain: string): Promise<boolean> {
    try {
      return await verify(passwordHash, plain, ARGON2_OPTIONS);
    } catch {
      return false;
    }
  }

  /** 强度校验：不满足直接抛参数错误（消息面向用户） */
  assertStrong(plain: string, context: { email?: string } = {}): void {
    if (plain.length < MIN_LENGTH) {
      throw AppError.invalidParams(`密码至少 ${MIN_LENGTH} 位`);
    }
    if (plain.length > MAX_LENGTH) {
      throw AppError.invalidParams(`密码最长 ${MAX_LENGTH} 位`);
    }
    const lower = plain.toLowerCase();
    if (WEAK_PASSWORDS.has(lower)) {
      throw AppError.invalidParams('这个密码太常见了，换一个吧');
    }
    if (context.email && lower === context.email.toLowerCase()) {
      throw AppError.invalidParams('密码不能和邮箱相同');
    }
    if (/^(\d)\1+$/.test(plain) || /^(.)\1+$/.test(plain)) {
      throw AppError.invalidParams('密码不能是重复的单个字符');
    }
  }
}
