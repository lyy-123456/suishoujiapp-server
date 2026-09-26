// 本地开发从 .env 读取；容器里用 compose/平台注入的环境变量（dotenv 不会覆盖已存在的变量）
import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ResponseInterceptor } from './common/response.interceptor';
import { corsOrigins, env, isProduction } from './config/env';
import { closeDb } from './db/client';

async function bootstrap(): Promise<void> {
  // 先校验环境变量：缺项直接退出，别带着半截配置跑起来
  const config = env();
  const logger = new Logger('bootstrap');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true,
      logger: { level: config.LOG_LEVEL },
      bodyLimit: 5 * 1024 * 1024,
    }),
    { bufferLogs: false },
  );

  // 健康检查不带前缀，业务接口统一 /api/v1
  app.setGlobalPrefix('api/v1', { exclude: ['healthz', 'readyz'] });

  // 统一响应封装 { code, message, data, requestId } 与统一异常出口
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  const origins = corsOrigins();
  if (origins.length > 0) {
    app.enableCors({
      origin: origins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
      maxAge: 600,
    });
    logger.log(`CORS 白名单：${origins.join(', ')}`);
  }

  // 让容器收到 SIGTERM 时能优雅退出（先停止接收新请求，再关连接池）
  app.enableShutdownHooks();

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.log(`suishouji-server 已启动：http://${config.HOST}:${config.PORT}（${config.NODE_ENV}）`);
  if (!isProduction()) {
    logger.log('开发模式：健康检查 GET /healthz ，就绪检查 GET /readyz');
  }
}

async function shutdown(signal: string): Promise<void> {
  new Logger('bootstrap').warn(`收到 ${signal}，正在关闭…`);
  await closeDb().catch(() => undefined);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

bootstrap().catch(err => {
  console.error('[fatal] 启动失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
