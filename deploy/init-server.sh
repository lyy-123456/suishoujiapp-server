#!/usr/bin/env bash
#
# 服务器初始化（Ubuntu 22.04 / 24.04，root 执行）
#
# 做这些事：
#   1. 基础依赖 + Docker（含 compose 插件）
#   2. Docker 日志限额（防日志撑爆磁盘）
#   3. 2G swap（2C2G 机器上防 OOM，宁可慢一点也别被杀进程）
#   4. journald 日志上限
#   5. 防火墙：只放行 22/80/443
#   6. fail2ban + 自动安全更新
#   7. 创建应用目录 /opt/suishouji
#
# 用法：
#   sudo bash init-server.sh
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/suishouji}"
SWAP_SIZE="${SWAP_SIZE:-2G}"

if [ "$(id -u)" -ne 0 ]; then
  echo "❌ 请用 root 或 sudo 执行" >&2
  exit 1
fi

if ! grep -qi ubuntu /etc/os-release; then
  echo "⚠️  这个脚本按 Ubuntu 写的，其它发行版请自行调整包管理器命令"
fi

echo "==> 1/7 安装基础依赖"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  ca-certificates curl gnupg ufw fail2ban unattended-upgrades

echo "==> 2/7 安装 Docker"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  ARCH="$(dpkg --print-architecture)"
  CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME:-jammy}")"
  echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "    已安装，跳过"
fi

echo "==> 3/7 Docker 日志限额"
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
systemctl restart docker

echo "==> 4/7 配置 swap（${SWAP_SIZE}）"
if swapon --show | grep -q .; then
  echo "    已有 swap，跳过"
else
  if ! fallocate -l "$SWAP_SIZE" /swapfile 2>/dev/null; then
    dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  fi
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -w vm.swappiness=10 >/dev/null
grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf

echo "==> 5/7 journald 日志上限"
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/size.conf <<'CONF'
[Journal]
SystemMaxUse=200M
CONF
systemctl restart systemd-journald

echo "==> 6/7 防火墙（只放行 22/80/443）"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "==> 7/7 fail2ban + 自动安全更新"
systemctl enable --now fail2ban >/dev/null 2>&1
echo 'unattended-upgrades unattended-upgrades/enable_auto_updates boolean true' | debconf-set-selections || true
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

mkdir -p "$APP_DIR/backups"

echo
echo "✅ 初始化完成"
echo
echo "接下来："
echo "  1) 把 deploy/ 目录里的文件上传到 $APP_DIR（Caddyfile、docker-compose.yml、backup.sh、update.sh）"
echo "  2) cp $APP_DIR/.env.example $APP_DIR/.env 并填写密钥与密码"
echo "  3) docker login ghcr.io  # 私有镜像需要（用有 read:packages 权限的 PAT）"
echo "  4) cd $APP_DIR && docker compose up -d"
echo "  5) docker compose run --rm api node dist/db/migrate.js"
echo "  6) curl -s https://api.landery.cn/healthz"
echo
echo "内存现状：$(free -h | awk '/Mem:/ {print $2" 总 / "$7" 可用"}')，swap：$(free -h | awk '/Swap:/ {print $2}')"
