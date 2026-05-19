# 策略手动触发监控 设计

**日期：** 2026-05-19
**范围：** `apps/web/app/strategies/[id]/page.tsx`

## 背景

当前监控分析仅通过 pg-boss 定时任务（每日 02:00 UTC）自动触发。用户希望能在策略详情页手动触发单个策略的监控分析，以便在定时任务之外按需获取最新分析结果。

## 现状

`POST /api/monitoring/trigger/[strategyId]` 路由已存在，发送 job 到 pg-boss 队列 `"daily-monitoring"` 后由 worker 异步处理（抓取最新价格 + Claude 分析 + 写入 `monitoring_runs` 表）。该接口尚未绑定任何 UI 入口。

## 方案

仅修改策略详情页，添加"立即分析"按钮。无需改动 API、数据库 schema 或 worker。

## 设计

### UI 位置

策略详情页 Header 行右侧，与策略名、标签并排：

```
← QQQ Momentum  [QQQ] [SPY]          [▶ 立即分析]
```

### 按钮状态机

| 状态 | 触发条件 | 按钮文字 | 按钮是否禁用 |
|------|---------|---------|------------|
| 默认 | 初始/提示消失后 | 立即分析 | 否 |
| 触发中 | 点击后到 API 响应 | 触发中... | 是（含 spinner） |
| 成功 | API 返回 200/204 | 立即分析 | 否 |
| 失败 | API 返回非 2xx 或网络错误 | 立即分析 | 否 |

### 状态提示文字

按钮下方（Header 行下一行）显示 inline 提示，3 秒后自动清除：

- **成功**：`✓ 分析已触发，稍后在「最近分析」Tab 查看结果`（浅色 muted）
- **失败**：`触发失败，请重试`（红色 destructive）

### 数据流

```
点击"立即分析"
  → 按钮进入"触发中"状态（禁用 + spinner）
  → POST /api/monitoring/trigger/${strategyId}
  → 成功：按钮恢复，显示成功提示 3 秒
  → 失败：按钮恢复，显示失败提示 3 秒
```

分析结果由 worker 异步写入 DB，用户手动切换到"最近分析" Tab 查看。

## 实现范围

**修改文件：**
- `apps/web/app/strategies/[id]/page.tsx`
  - 新增 `triggerStatus` state（`"idle" | "loading" | "success" | "error"`）
  - 新增 `handleTrigger()` 函数
  - Header 行右侧添加按钮 + 提示文字

**不变：**
- API 路由（已存在）
- Worker 逻辑
- 数据库 schema
- 其他页面

## 验收标准

1. 策略详情页 Header 右侧有"立即分析"按钮，任意 Tab 下可见
2. 点击后按钮立即禁用并显示"触发中..."
3. API 成功后按钮恢复，显示成功提示文字，3 秒后消失
4. API 失败后按钮恢复，显示失败提示文字，3 秒后消失
5. 触发期间无法重复点击（防重复提交）
