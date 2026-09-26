import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppError } from './errors';

/**
 * 用 Zod 校验请求体/查询参数。
 * 用法：`@Body(zodBody(loginSchema)) dto: LoginInput`
 *
 * 好处：schema 即是类型（z.infer），也是运行时校验，不会出现"类型对但数据脏"。
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      const fields = result.error.issues.map(issue => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      }));
      throw AppError.invalidParams('参数校验失败', fields);
    }
    return result.data;
  }
}

export function zodBody<T>(schema: ZodType<T>): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}

export function zodQuery<T>(schema: ZodType<T>): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}
