import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ErrorCode, codeFromHttpStatus } from './errors';

/**
 * 全局异常出口：把任何异常归一化成 `{ code, message, data: null, requestId }`。
 * - AppError：业务错误，原样输出
 * - HttpException：按状态码映射业务码
 * - 其它：一律 5000，细节只进日志（不泄露内部实现）
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest & { id?: string }>();
    const requestId = String(request?.id ?? '');

    let httpStatus = 500;
    let code: number = ErrorCode.INTERNAL;
    let message = '服务器开小差了，请稍后再试';
    let details: unknown;

    if (exception instanceof AppError) {
      httpStatus = exception.httpStatus;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      httpStatus = exception.getStatus();
      code = codeFromHttpStatus(httpStatus);
      const response = exception.getResponse();
      if (typeof response === 'string') {
        message = response;
      } else if (response && typeof response === 'object') {
        const maybe = response as { message?: unknown; error?: unknown };
        message =
          typeof maybe.message === 'string'
            ? maybe.message
            : Array.isArray(maybe.message)
              ? maybe.message.join('; ')
              : exception.message;
      }
    }

    // 5xx 记完整堆栈，4xx 只记一行，避免日志被正常业务噪声淹没
    if (httpStatus >= 500) {
      this.logger.error(
        `${request?.method ?? '-'} ${request?.url ?? '-'} → ${httpStatus} [${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.debug(
        `${request?.method ?? '-'} ${request?.url ?? '-'} → ${httpStatus} code=${code} ${message}`,
      );
    }

    reply.code(httpStatus).send({
      code,
      message,
      data: details === undefined ? null : { details },
      requestId,
    });
  }
}
