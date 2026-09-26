import { Module } from '@nestjs/common';
import { HealthController } from './modules/health/health.controller';

/**
 * 应用主模块。
 * 后续按阶段挂载：AuthModule（账号）、SyncModule（增量同步）、EntitiesModule（业务 CRUD）、
 * FilesModule（图片直传）、GeoModule（地图代理）、AdminModule（管理端）。
 */
@Module({
  imports: [],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
