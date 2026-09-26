import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AuthContext, AuthUser } from './auth.service';
import type { AuthedRequest } from './auth.guard';

/** 取当前登录用户（需配合 @UseGuards(AuthGuard)） */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const request = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!request.user) throw new Error('CurrentUser 必须在 AuthGuard 之后使用');
  return request.user;
});

/** 取请求上下文（ip / UA / 设备名），用于审计与设备管理 */
export const RequestCtx = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const request = ctx.switchToHttp().getRequest<FastifyRequest & { body?: { deviceName?: string } }>();
  const forwarded = request.headers['x-forwarded-for'];
  const fromHeader = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : '';
  const ip = fromHeader || request.ip || '';
  return {
    ip,
    userAgent: String(request.headers['user-agent'] ?? ''),
    deviceName: request.body?.deviceName,
  };
});
