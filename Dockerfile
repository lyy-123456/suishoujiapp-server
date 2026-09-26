# ---- 构建阶段 ----
FROM node:22-slim AS build
WORKDIR /app

# 由 CI 传入（package.json 的版本号），用于 /healthz 显示
ARG APP_VERSION=dev

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY drizzle ./drizzle
RUN npm run build

# ---- 运行阶段 ----
# 用 Debian slim 而不是 alpine：原生模块（@node-rs/argon2）的预编译二进制在 glibc 上覆盖最全，
# musl 下曾有找不到二进制的坑，启动即崩 —— 镜像大 80MB 换"一次跑通"划算
FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist
# 迁移文件进镜像，部署时执行 node dist/db/migrate.js
COPY drizzle ./drizzle

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
