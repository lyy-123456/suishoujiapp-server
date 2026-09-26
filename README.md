# suishouji-server

「随手记」的后端服务：**账号 + 云备份 + 多端增量同步 + 管理端 API**。

前端仓库是 `youshuapp`（React PWA / 安卓 APK / iOS），两者通过 OpenAPI 契约解耦，互不依赖源码。

---

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 运行时 | Node.js 22 | 与前端同语言，单人维护成本低 |
| 框架 | NestJS 11 + Fastify | 模块化 + Guard/Interceptor 适合做鉴权、审计、限流 |
| 数据库 | PostgreSQL 16 | 事务、数组/JSONB、成熟备份工具链 |
| ORM | Drizzle ORM + drizzle-kit | 纯 TS，无 Rust 引擎常驻进程（2C2G 上比 Prisma 省 100~180MB） |
| 校验 | Zod | 环境变量与请求体全量校验，fail-fast |
| 密码哈希 | @node-rs/argon2（Argon2id） | 预编译二进制，无需 node-gyp |
| 令牌 | @nestjs/jwt（HS256）+ 不透明 refresh token | access 15 分钟，refresh 单次使用轮换 |
| 反代 | Caddy 2 | 自动 HTTPS、安全响应头 |
| 对象存储 | S3 兼容（云 OSS / MinIO） | 图片私有读 + 预签名直传 |

---

## 目录

```
src/
├── main.ts                    # 启动：校验环境变量 → 建 Fastify → 挂全局前缀 / 优雅退出
├── app.module.ts              # 主模块（后续挂 AuthModule / SyncModule / …）
├── config/env.ts              # 环境变量 schema（缺项直接起不来）
├── db/
│   ├── schema.ts              # 全部表定义（含全局 change_seq 同步游标）
│   ├── client.ts              # pg Pool + drizzle 实例 + 就绪探针
│   └── migrate.ts             # 迁移入口：node dist/db/migrate.js
└── modules/health/            # /healthz（存活） /readyz（就绪，查 DB）
drizzle/                       # 迁移 SQL + 快照（drizzle-kit 生成，需提交）
deploy/                        # docker-compose + Caddyfile + backup.sh + .env.example
```

---

## 快速开始（本地）

```bash
npm install
cp .env.example .env          # 填 JWT_SECRET / REFRESH_TOKEN_PEPPER，并指向本地 PG
docker compose -f deploy/docker-compose.yml up -d postgres   # 只起数据库（或用本机 PG）
npm run db:migrate            # 建表
npm run dev                   # http://localhost:3000
curl localhost:3000/healthz   # {"ok":true,...}
```

> 本地没有 Postgres 也能启动：`/healthz` 返回 200，`/readyz` 返回 503（这正是它的用途）。

---

## 环境变量

见 `.env.example`（含生成密钥的命令）。要点：

- `JWT_SECRET`（≥32 字符）、`REFRESH_TOKEN_PEPPER`（≥16 字符）必须自己生成，**不要复用示例值**
- `ALLOW_REGISTER=false` + `INVITE_CODE=xxx`：人少场景默认邀请码注册，防刷
- `CORS_ORIGINS`：手机壳改 origin 后填 `https://app.suishouji.local`，iOS 填 `capacitor://localhost`
- `AMAP_KEY` **只存在服务端**，通过 `/api/v1/geo/*` 代理给客户端，避免 key 被打包进 APK 被抓走

---

## 数据库与迁移

改完 `src/db/schema.ts`：

```bash
npm run db:generate     # 生成 drizzle/000N_xxx.sql（离线，不需要连库）
npm run db:migrate      # 应用到数据库
```

CI 会校验"schema 改了但迁移没提交"的情况。

**同步设计要点**：所有业务表都有 `seq`（取自全局序列 `change_seq`）、`version`、`deleted_at`，
客户端用 `since=<seq>` 一个游标即可拉取全部实体的增量，删除用墓碑防止"旧端把数据复活"。

## 测试

```bash
npm test        # 端到端，跑在 pg-mem（内存版 Postgres）上，不需要 Docker/数据库
```

测试直接应用**真实的迁移 SQL** 并用真实的 drizzle 查询跑通 HTTP 层（Fastify `inject`），
覆盖：邀请码注册、弱密码、重复邮箱、登录失败锁定、令牌校验、刷新令牌轮换与复用检测、
改密后旧令牌失效、会话列表、登出、审计落库。

> `test/pg-mem.ts` 里有两处必要的补丁（剥掉 drizzle 传的 `types`/`rowMode` 并按列序把对象行转数组），
> 原因写在注释里 —— 没有它们 drizzle 在 pg-mem 上完全跑不起来。

---

## 部署（单机 2C2G）

```bash
cd deploy
cp .env.example .env      # 填 API_DOMAIN / POSTGRES_PASSWORD / JWT_SECRET / REFRESH_TOKEN_PEPPER
docker compose up -d
docker compose exec api node dist/db/migrate.js
```

- 只有 Caddy 暴露 80/443；PostgreSQL 仅在 `internal` 网络（无外网出口），公网不可达
- 每个服务都设了 `mem_limit`，PostgreSQL 参数按 2C2G 调优（见 `deploy/docker-compose.yml`）
- `backup` 容器每日 `pg_dump` 并保留 30 天，支持接 restic 做加密异地备份
- **境内服务器必须先完成域名备案**，否则 80/443 会被云厂商拦截

---

## 阶段与现状

| 阶段 | 内容 | 状态 |
|---|---|---|
| T2.1 | 仓库脚手架（环境校验、Drizzle schema、健康检查、Docker/Compose、CI） | ✅ 已完成 |
| T2.2 | 认证模块（注册/登录/刷新轮换+复用检测/登出/改密/会话管理、Argon2id、失败锁定、审计） | ✅ 已完成（17 项端到端测试通过） |
| T2.3 | 用户与设置（`GET /auth/me` 已随 T2.2 完成；设置读写待做） | 🔄 进行中 |
| T2.4+ | 文件直传、备份导入导出、地理代理、限流、同步接口、管理端 | ⬜ 待做 |

### 已实现接口

```
POST   /api/v1/auth/register     注册（默认需邀请码）
POST   /api/v1/auth/login        登录（失败 5 次锁 15 分钟）
POST   /api/v1/auth/refresh      刷新令牌（单次使用 + 轮换 + 复用即吊销全部会话）
POST   /api/v1/auth/logout       登出（可 allDevices 退全部）
POST   /api/v1/auth/password     改密（旧令牌立刻失效，并给当前设备换发新令牌）
GET    /api/v1/auth/me           当前用户
GET    /api/v1/auth/sessions     已登录设备
DELETE /api/v1/auth/sessions/:id 踢掉某台设备
GET    /healthz  /readyz         存活 / 就绪探针
```

设计与验收标准见前端仓库的 `docs/backend-technical-plan.md` 与 `docs/modification-plan.md`。
