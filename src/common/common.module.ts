import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/** 全局公共能力（审计等），业务模块直接注入即可 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class CommonModule {}
