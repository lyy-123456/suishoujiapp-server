#!/usr/bin/env bash
#
# 在服务器上更新到最新镜像：拉取 → 跑迁移 → 重启 → 健康检查
#
# 用法（在 /opt/suishouji 下）：
#   ./update.sh            # 更新到 .env 里 API_IMAGE 指向的 tag（通常 latest）
#   ./update.sh 0.2.0      # 更新到指定版本（便于回滚/固定版本）
#
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE="docker compose"

if [ $# -ge 1 ]; then
  echo "==> 固定镜像版本为 $1"
  sed -i "s|^API_IMAGE=.*|API_IMAGE=ghcr.io/lyy-123456/suishoujiapp-server:$1|" .env
fi

echo "==> 拉取镜像"
$COMPOSE pull

echo "==> 应用数据库迁移"
$COMPOSE run --rm api node dist/db/migrate.js

echo "==> 重启服务"
$COMPOSE up -d

echo "==> 等待服务就绪"
for i in $(seq 1 20); do
  if $COMPOSE exec -T api node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    echo "    ✅ /healthz 正常"
    break
  fi
  if [ "$i" = "20" ]; then
    echo "    ❌ 健康检查失败，最近日志：" >&2
    $COMPOSE logs --tail=40 api >&2
    exit 1
  fi
  sleep 2
done

echo "==> 清理旧镜像（只保留最近使用的）"
docker image prune -f >/dev/null

echo
echo "✅ 更新完成：$(docker compose images api --format '{{.Repository}}:{{.Tag}}' 2>/dev/null || echo '')"
echo "   外网自检：curl -s https://api.landery.cn/healthz"
