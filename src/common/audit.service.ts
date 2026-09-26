import { Inject, Injectable, Logger } from '@nestjs/common';
import { DB, type Database } from '../db/database.module';
import { auditLog } from '../db/schema';

export interface AuditEntry {
  /** 操作者（未登录场景如登录失败可为空） */
  actorId?: string | null;
  /** 动作标识，如 login.success / login.failed / auth.refresh_reuse */
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string;
  userAgent?: string;
  detail?: unknown;
}

/**
 * 审计日志。**永不因写审计失败而影响主流程**（只记警告）。
 * 敏感操作（登录、改密、踢下线、数据导出、后台查看他人数据）都必须落审计。
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('audit');

  constructor(@Inject(DB) private readonly db: Database) {}

  record(entry: AuditEntry): void {
    void this.db
      .insert(auditLog)
      .values({
        actorId: entry.actorId ?? null,
        action: entry.action,
        targetType: entry.targetType ?? '',
        targetId: entry.targetId ?? '',
        ip: entry.ip ?? '',
        userAgent: (entry.userAgent ?? '').slice(0, 512),
        detail: entry.detail ?? null,
      })
      .catch(err => {
        this.logger.warn(`写审计失败 action=${entry.action}: ${err instanceof Error ? err.message : String(err)}`);
      });
  }
}
