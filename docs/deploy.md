# 部署

项目支持两种部署模式。**优先用主模式**；只有当服务器资源吃紧、`docker build` 跑不动时才切到备用模式。

| | 主模式（默认） | 备用模式 |
|---|---|---|
| **何时用** | 服务器内存 / CPU 充足 | 服务器扛不住 web 的 docker build（典型表现：构建 OOM） |
| **代码到服务器** | `git pull` | `git pull` + 本地构建 web 产物，手动上传 |
| **web 镜像怎么来** | 服务器上 `docker build`（Dockerfile 的 `web` stage） | 本地 `npm run build` 生成 standalone，bind-mount 进 `node:20-alpine` |
| **worker 镜像怎么来** | 服务器上 `docker build`（Dockerfile 的 `worker` stage） | 同主模式 — worker 仍然在服务器上 build |
| **Postgres / db-migrate** | docker-compose 编排，原样 | 同主模式 |
| **compose 命令** | `docker compose up -d` | `docker compose -f docker-compose.yml -f docker-compose.prebuilt.yml up -d` |

---

## 主模式：服务器构建（默认）

```bash
# 服务器一次性准备
git clone <repo> /opt/trader
cd /opt/trader
cp .env.example .env
vi .env   # 填 POSTGRES_PASSWORD / ANTHROPIC_* / TAVILY_API_KEY / DATABASE_URL

# 部署
docker compose --profile tools run --rm db-migrate   # 第一次或 schema 改动时
docker compose up -d
docker compose ps
```

发版：
```bash
cd /opt/trader
git pull --ff-only
docker compose up -d --build           # 重新构建变更过的镜像
```

---

## 备用模式：本地构 web、服务器跑

仅当主模式跑不动时启用。worker 与 db 仍按主模式构建——只有 web 走预构产物。

### 一次性

服务器：和主模式相同（git clone + .env），外加：
```bash
cd /opt/trader
mkdir -p deploy/web
```

确认 `docker compose version` ≥ v2.20（备用模式用了 `!reset` 语法）。版本不够时直接编辑 `docker-compose.yml`，把 `web` 服务的 `build:` 字段删掉（参考 `docker-compose.prebuilt.yml` 头注释）。

### 每次发版

**本地（开发机）：**
```bash
./scripts/build-local.sh
# → deploy-bundle/web.tar.gz  (~22MB，可走 Web Shell 上传)
```

**Aliyun Web Shell 把 `web.tar.gz` 上传到服务器（建议放 `/tmp/`），然后：**
```bash
cd /opt/trader
git pull --ff-only                               # 可能更新了 compose / worker 源码
rm -rf deploy/web && mkdir -p deploy
tar -xzf /tmp/web.tar.gz -C deploy/
# 如果 schema 改动过，先迁移
docker compose --profile tools run --rm db-migrate
# 拉起 stack（worker 会按需 rebuild）
docker compose -f docker-compose.yml -f docker-compose.prebuilt.yml up -d
docker compose -f docker-compose.yml -f docker-compose.prebuilt.yml ps
```

### 只改 web、worker 没动时的快路径

```bash
# 本地
./scripts/build-local.sh
# 上传 web.tar.gz 后，Web Shell 里：
cd /opt/trader
rm -rf deploy/web
tar -xzf /tmp/web.tar.gz -C deploy/
docker compose -f docker-compose.yml -f docker-compose.prebuilt.yml restart web
```

### 只改 worker、web 没动时的快路径

```bash
# 推 git 后，Web Shell 里：
cd /opt/trader
git pull --ff-only
docker compose -f docker-compose.yml -f docker-compose.prebuilt.yml up -d --build worker
```

---

## 备用模式实现要点

- `apps/web/next.config.ts` 设置 `outputFileTracingRoot` 锚定 monorepo 根，保证 standalone 产物路径是 `apps/web/server.js`（与 docker 内部一致）
- `scripts/build-local.sh` 在 `.deploy-staging/` 隔离构建，本地 `node_modules` 始终是宿主架构（Mac arm64），`npm test` / `npm run dev` 不受影响
- 跨架构：`npm install --cpu=x64 --os=linux --libc=musl --include=optional --ignore-scripts`，让 Next.js standalone 打包进 Linux x64 musl 的 native 依赖（主要是 sharp）
- `docker-compose.prebuilt.yml` 用 compose v2.20 的 `!reset` 把 web 的 `build:` 字段抹掉，再补上 `image: node:20-alpine` + bind-mount

## 排错

| 现象 | 排查 |
|---|---|
| web 启动报 `Cannot find module 'sharp'` 或 `wrong ELF` | 本地 `npm install` 那步没拉到 Linux 二进制；确认用的是 `--cpu=x64 --os=linux --libc=musl --include=optional`。临时绕过：在 `next.config.ts` 加 `images: { unoptimized: true }` |
| `docker compose: unknown field !reset` | compose 版本 < v2.20；按 `docker-compose.prebuilt.yml` 头注释直接改 base 文件 |
| 上传后 web 容器起不来 / `EACCES` | bind-mount 权限问题；`chown -R <docker 运行用户>:<组> /opt/trader/deploy/` |
| worker 看不到 `daily-news` cron | `docker compose ... logs worker`，确认有 `daily-news cron registered (30 1 * * * UTC = 09:30 CST)` 这行；没有的话检查 `git pull` 是否拉到最新 worker 代码 |
| `summary content` 全是「摘要生成失败，请稍后重试」 | `.env` 里 `TAVILY_API_KEY` 没配，或 LLM 网关挂了；`docker compose ... logs worker` 看 `[news]` 日志 |
