import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { map, type Observable } from 'rxjs';

export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
  requestId: string;
}

/**
 * 统一响应封装：`{ code, message, data, requestId }`。
 * 健康检查（/healthz、/readyz）等非 /api 路径保持原样，方便容器探针直接判断。
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiEnvelope<T> | T> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiEnvelope<T> | T> {
    const request = context.switchToHttp().getRequest<FastifyRequest & { id?: string }>();
    const url = request?.url ?? '';

    if (!url.includes('/api/')) {
      return next.handle();
    }

    return next.handle().pipe(
      map(data => ({
        code: 0,
        message: 'ok',
        data: (data ?? null) as T,
        requestId: String(request.id ?? ''),
      })),
    );
  }
}
