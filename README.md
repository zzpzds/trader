# Trader

AI 驱动的交易策略管理系统，帮助个人投资者管理多个股票策略的持仓、监控和分析。

## 功能

- **策略管理** — 上传或粘贴 Python 交易策略脚本，由 Claude 自动解析名称、标的和描述
- **持仓跟踪** — 记录每笔买入 lot，计算加权均价，支持参考价设定与 inline 编辑
- **AI 监控** — Worker 定时拉取行情，调用 LLM 分析策略执行情况，有操作信号时推送通知
- **参考价自动维护** — LLM 根据策略规则（如涨超 15% 重置加仓基准）自动更新参考价，也支持手动覆盖

## 技术栈

- **前端** — Next.js 16 (App Router), React 19, TypeScript, TailwindCSS, shadcn/ui
- **后端** — Next.js API Routes + Node.js Worker
- **数据库** — PostgreSQL 16, Drizzle ORM
- **AI** — Anthropic Claude（兼容 OpenAI 格式代理）
- **行情** — Alpha Vantage API
- **部署** — Docker Compose

## 项目结构

```
apps/
  web/      # Next.js 前端 + API Routes
  worker/   # 后台监控 Job（定时拉行情 + LLM 分析）
packages/
  db/       # Drizzle schema 与数据库工具（共享）
```

## 本地开发

**环境要求：** Node.js 20+, PostgreSQL 16

```bash
# 安装依赖
npm install

# 复制并填写环境变量
cp .env.example .env

# 推送数据库 schema
cd packages/db && npx drizzle-kit push

# 启动开发服务器（web + worker）
npm run dev
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接字符串 |
| `ANTHROPIC_API_KEY` | Anthropic API Key |
| `ANTHROPIC_BASE_URL` | API 代理地址（可选） |
| `ANTHROPIC_MODEL` | 使用的模型（默认 claude-sonnet） |
| `ALPHAVANTAGE_API_KEY` | Alpha Vantage 行情 API Key |

## Docker 部署

```bash
# 复制并填写环境变量
cp .env.example .env

# 构建并启动
docker compose up -d

# 首次部署或 schema 变更后执行数据库迁移
docker compose --profile tools run --rm db-migrate
```

服务启动后访问 `http://localhost`。
