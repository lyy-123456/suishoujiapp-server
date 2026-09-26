#!/bin/sh
#
# 每日备份：pg_dump → gzip → /backups，并保留 BACKUP_KEEP_DAYS 天。
#
# 加密异地备份（强烈建议，装上 restic 后启用）：
#   apk add --no-cache restic
#   export RESTIC_REPOSITORY / RESTIC_PASSWORD（见 .env）
#   备份完成后自动 restic backup，仓库建议放对象存储（S3 兼容）
#
# 注意：没演练过的备份不算备份 —— 每季度在干净环境恢复一次。

set -e

echo "[backup] 启动，每 24 小时执行一次（首次立即执行）"

sleep 5

while true; do
  STAMP="$(date +%Y%m%d-%H%M%S)"
  FILE="/backups/suishouji-${STAMP}.dump"
  echo "[backup] $(date '+%F %T') pg_dump → ${FILE}"
  if pg_dump --format=custom --compress=6 --file="${FILE}"; then
    echo "[backup] 完成，大小：$(du -h "${FILE}" | cut -f1)"
    if [ -n "${RESTIC_REPOSITORY}" ] && command -v restic >/dev/null 2>&1; then
      echo "[backup] restic 异地备份…"
      restic backup "${FILE}" || echo "[backup] restic 失败（保留本地副本）"
    fi
  else
    echo "[backup] ❌ pg_dump 失败" >&2
  fi

  # 清理过期备份
  find /backups -name 'suishouji-*.dump' -mtime "+${BACKUP_KEEP_DAYS:-30}" -print -delete || true

  sleep 86400
done
