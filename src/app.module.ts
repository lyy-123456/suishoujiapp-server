import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './db/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthController } from './modules/health/health.controller';

/**
 * 应用主模块。
 * 后续按阶段挂载：SyncModule（增量同步）、EntitiesModule（业务 CRUD）、
 * FilesModule（图片直传）、GeoModule（地图代理）、AdminModule（管理端）。
 */
@Module({
  imports: [DatabaseModule, CommonModule, AuthModule],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
