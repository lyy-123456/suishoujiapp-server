# 部署手册（单机 2C2G · api.landery.cn）

从零到跑通大约 20 分钟。按顺序做即可。

---

## 0. 前置确认

| 项 | 怎么确认 | 期望 |
|---|---|---|
| DNS | `dig +short api.landery.cn`（或本地 `nslookup`） | 返回你服务器的**公网 IP** |
| 备案 | 域名已在工信部备案（你说已完成） | 否则云厂商会拦 80/443 |
| 端口 | 安全组/防火墙放行 22、80、443 | 80 必须放行：Let's Encrypt 要用它做校验 |
| 架构 | 服务器上 `uname -m` | `x86_64` 或 `aarch64` 都行（镜像双架构） |
| 内存 | `free -h` | 2G 左右（脚本会补 2G swap） |

---

## 1. 初始化服务器

把 `deploy/init-server.sh` 传上去执行（会装 Docker、配 swap、开防火墙、启 fail2ban）：

```bash
scp deploy/init-server.sh root@<服务器IP>:/root/
ssh root@<服务器IP>
bash /root/init-server.sh
```

脚本结束会打印内存/swap 现状。

---

## 2. 放好部署文件

```bash
mkdir -p /opt/suishouji && cd /opt/suishouji
# 本地执行（把 deploy 下的文件传上去）
scp deploy/docker-compose.yml deploy/Caddyfile deploy/backup.sh deploy/update.sh deploy/.env.example root@<服务器IP>:/opt/suishouji/
```

服务器上：

```bash
cd /opt/suishouji
chmod +x update.sh backup.sh
cp .env.example .env
chmod 600 .env
```

---

## 3. 填写 .env（关键步骤）

生成两个密钥：

```bash
openssl rand -base64 48   # → JWT_SECRET
openssl rand -base64 24   # → REFRESH_TOKEN_PEPPER
```

编辑 `/opt/suishouji/.env`，**必须改**的项：

| 变量 | 填什么 |
|---|---|
| `API_IMAGE` | `ghcr.io/lyy-123456/suishoujiapp-server:latest` |
| `POSTGRES_PASSWORD` | 强密码（`openssl rand -base64 24`） |
| `JWT_SECRET` | 上面第一条命令的输出（≥32 字符） |
| `REFRESH_TOKEN_PEPPER` | 上面第二条命令的输出（≥16 字符） |
| `INVITE_CODE` | 你自己定一个，注册时要填（`ALLOW_REGISTER=false`） |
| `AMAP_KEY` | 你新申请的高德 Web 服务 key（只放服务端） |
| `CORS_ORIGINS` | 保持 `https://app.suishouji.local,capacitor://localhost`（手机壳改 origin 后用） |

`.env` 一个文件同时供 compose 变量替换和 api 容器读取，所以别漏项 —— 服务启动时会**校验失败直接退出**，这是故意的。

---

## 4. 登录镜像仓库（私有包需要）

GHCR 的包默认私有。两种做法，选一个：

**A. 登录（推荐，代码不外泄）** —— 在 GitHub → Settings → Developer settings → Personal access tokens 建一个 **classic token，只勾 `read:packages`**：

```bash
echo "<你的PAT>" | docker login ghcr.io -u lyy-123456 --password-stdin
```

**B. 把包设为公开** —— GitHub → 你的 profile → Packages → `suishoujiapp-server` → Package settings → Change visibility → Public。公开后服务器不用登录就能拉，但**编译后的后端代码任何人可下载**。

---

## 5. 启动

```bash
cd /opt/suishouji
docker compose up -d          # 起 caddy + api + postgres + backup
docker compose run --rm api node dist/db/migrate.js   # 建表
docker compose ps
```

首次启动 Caddy 会向 Let's Encrypt 申请证书（约 10~30 秒）。看日志：

```bash
docker compose logs -f caddy | grep -i certificate
```

---

## 6. 验证

```bash
# 存活（不依赖数据库）
curl -s https://api.landery.cn/healthz
# → {"ok":true,"service":"suishouji-server","version":"0.1.0","env":"production","uptime":12}

# 就绪（查数据库）
curl -s https://api.landery.cn/readyz
# → {"ok":true,"db":"up"}

# 注册一个账号（把邀请码换成你 .env 里设的）
curl -sX POST https://api.landery.cn/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"YourStrongPass123","inviteCode":"你的邀请码"}'
# → {"code":0,"message":"ok","data":{"user":{...},"accessToken":"...","refreshToken":"..."},...}

# 登录
curl -sX POST https://api.landery.cn/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"YourStrongPass123"}'
```

用拿到的 `accessToken` 调受保护接口：

```bash
curl -s https://api.landery.cn/api/v1/auth/me -H "authorization: Bearer <accessToken>"
```

---

## 7. 日常更新与回滚

镜像由 GitHub Actions 自动构建（push 到 `main` 触发）。在服务器上：

```bash
cd /opt/suishouji
./update.sh            # 拉 latest → 迁移 → 重启 → 健康检查（失败自动打印日志）
./update.sh 0.2.0      # 固定/回滚到指定版本
```

回滚要点：**迁移只做加列不做删列**，所以旧镜像能直接跑在新库结构上。

---

## 8. 备份与恢复

- `backup` 容器每 24 小时跑一次 `pg_dump`，写到卷 `backups`，保留 30 天
- 查看：`docker compose exec backup ls -lh /backups`

恢复演练（**每季度做一次，没演练过的备份不算备份**）：

```bash
cd /opt/suishouji

# 1) 找到要恢复的备份文件名
docker compose exec backup sh -c 'ls -t /backups/*.dump | head -3'

# 2) 停 api（避免恢复过程中有写入），清空结构
docker compose stop api
docker compose exec -T postgres psql -U suishouji -d suishouji -c 'drop schema public cascade; create schema public;'

# 3) 用 backup 容器里的 pg_restore 恢复（它本来就连着 postgres，无需拷文件）
docker compose exec -T backup sh -c \
  'pg_restore -h postgres -U "$PGUSER" -d "$PGDATABASE" --no-owner /backups/<上面的文件名>.dump'

# 4) 起回来并验证
docker compose start api
curl -s https://api.landery.cn/readyz
```

> `docker compose exec` 需要能 SSH 到宿主机；如果 SSH 不通，用云厂商的 VNC/救援模式进系统后同样操作。

---

## 9. 排障

| 现象 | 原因 / 处理 |
|---|---|
| Caddy 日志报证书失败 | 80 端口没放行 / DNS 没解析到本机 / 域名没备案 |
| `502 Bad Gateway` | api 容器没起来：`docker compose logs api`（多半是 .env 缺项，启动时校验失败退出） |
| 客户端报 CORS | `.env` 的 `CORS_ORIGINS` 没包含真实 origin（手机壳是 `https://app.suishouji.local`，iOS 是 `capacitor://localhost`） |
| 磁盘满 | `docker system df`；`docker image prune -f`；日志已限额（10MB×3） |
| 内存告警 | `docker stats --no-stream`；各容器有 `mem_limit`，PG 限 768M、api 限 512M |
| 忘记邀请码 | 改 `.env` 的 `INVITE_CODE` 后 `docker compose up -d api` |

---

## 10. 上线后安全核对清单

- [ ] `chmod 600 .env`，且 `.env` 不在任何 git 仓库里
- [ ] `JWT_SECRET` / `REFRESH_TOKEN_PEPPER` 是自己生成的，不是示例值
- [ ] `ufw status` 只放行 22/80/443
- [ ] `docker compose ps` 中 postgres 没有对外映射端口（只有 caddy 映射 80/443）
- [ ] `curl -s https://api.landery.cn/readyz` 返回 `{"ok":true}`
- [ ] 备份文件确实在增长：`docker compose exec backup ls -lh /backups`
- [ ] 登录失败 6 次会返回 423（可以拿测试账号试）
- [ ] 确认 `AMAP_KEY` 只在服务端（客户端包里搜不到）
