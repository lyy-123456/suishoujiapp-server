import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { env, isProduction } from '../../config/env';
import { pingDb } from '../../db/client';

@Controller()
export class HealthController {
  /** 存活探针：进程活着就返回 200，不依赖数据库 */
  @Get('healthz')
  @HttpCode(200)
  healthz() {
    return {
      ok: true,
      service: 'suishouji-server',
      version: process.env.APP_VERSION ?? 'dev',
      env: env().NODE_ENV,
      uptime: Math.round(process.uptime()),
    };
  }

  /** 就绪探针：数据库不可用时返回 503，供负载/监控判断是否该打流量 */
  @Get('readyz')
  async readyz(@Res() reply: FastifyReply) {
    const dbOk = await pingDb();
    const body = { ok: dbOk, db: dbOk ? 'up' : 'down' };
    if (!dbOk) {
      // 生产环境不暴露内部细节
      reply.code(503).send(isProduction() ? { ok: false } : body);
      return;
    }
    reply.code(200).send(body);
  }
}
