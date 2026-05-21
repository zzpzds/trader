# 通知模块增强设计文档

**日期**：2026-05-21
**状态**：待实现

---

## 概述

将通知从侧边栏下拉面板升级为独立菜单页面，与监控中心风格统一，增强通知的管理和展示能力。

**核心改动：**
- 移除侧边栏铃铛下拉面板
- 新增独立通知页面（`/notifications`），作为侧边栏菜单项
- 增加筛选、批量操作、未读角标等管理功能
- 点击通知跳转到对应监控运行详情

**明确不做：**
- 浏览器推送通知 / 邮件通知 / 外部消息推送
- 通知偏好规则配置
- 通知实时推送（WebSocket / SSE）

---

## 导航变更

**移除：** `NotificationPanel` 组件（铃铛图标 + 下拉面板）

**新增侧边栏菜单项：**
```typescript
{ href: "/notifications", label: "通知", icon: Bell }
```

**菜单顺序：** 策略库 → 持仓管理 → 监控中心 → 通知

**未读角标：** 菜单项右侧显示未读数角标（红色圆形数字），未读为 0 时隐藏。角标数据通过轻量 API 获取，在侧边栏组件 mount 时加载一次。

---

## 通知列表页

**路径：** `/notifications`

### 页面结构

```
┌─────────────────────────────────────────────┐
│  [未读通知]  [今日新增]  [本周建议]          │  ← 统计卡片
├─────────────────────────────────────────────┤
│  全部|未读|已读   [策略筛选▼]               │  ← 筛选栏
│                    [全部标记已读] [删除已读]  │  ← 批量操作
├─────────────────────────────────────────────┤
│  ● 策略A建议减仓  [策略A]  05-21 10:00  ⋮  │  ← 通知行
│    策略B持仓正常   [策略B]  05-20 10:00  ⋮  │
│    ...                                       │
└─────────────────────────────────────────────┘
```

### 统计卡片

3 个小卡片横排：
- **未读通知**：当前未读通知总数
- **今日新增**：今日创建的通知数
- **本周建议**：本周 `has_action_items=true` 的通知数

### 筛选栏

- **已读状态**：全部 / 未读 / 已读（Tab 切换）
- **策略筛选**：下拉选择策略名称，数据来源为有通知的策略列表

### 批量操作

- **全部标记已读**：将所有未读通知标记为已读
- **删除已读**：删除所有已读通知

### 通知列表行

每行显示：
- 左侧未读圆点（未读时显示蓝色实心圆）
- 通知标题
- 策略名称标签（Badge）
- 创建时间
- 右侧操作菜单（标记已读 / 删除）

未读行有浅色背景（`bg-primary/5`）区分。

**点击行为：** 点击通知行 → 标记已读 → 跳转到 `/monitoring` 页面（后续可扩展为 `/monitoring/runs/[id]` 详情页）

### 空状态

无通知时显示：「暂无通知」居中提示

---

## API 变更

### GET `/api/notifications`（增强）

新增 query 参数：
- `status`：`all` | `unread` | `read`（默认 `all`）
- `strategyId`：按策略 ID 筛选（可选）

返回数据增强：
- 每条通知关联 `strategyId` 和 `strategyName`（通过 monitoringRuns → strategies join 获取）

返回格式：
```json
{
  "notifications": [
    {
      "id": "uuid",
      "monitoringRunId": "uuid",
      "strategyId": "uuid",
      "strategyName": "策略A",
      "title": "建议减仓",
      "content": "...",
      "isRead": false,
      "createdAt": "2026-05-21T02:00:00Z"
    }
  ],
  "unreadCount": 3,
  "todayCount": 1,
  "weekActionCount": 5
}
```

### DELETE `/api/notifications/[id]`（新增）

删除单条通知。

### DELETE `/api/notifications/read`（新增）

批量删除所有已读通知。

### 现有 API 保留不变

- PUT `/api/notifications/[id]/read` — 标记单条已读
- PUT `/api/notifications/read-all` — 全部标记已读

---

## 数据库

**无变更。** 现有 `notifications` 表 schema 满足需求。

---

## 前端组件变更

### 移除

- `components/layout/notification-panel.tsx` — 删除整个文件
- `components/layout/__tests__/notification-panel.test.tsx` — 删除测试文件
- `layout.tsx` 中移除 `NotificationPanel` 引用

### 新增

- `app/notifications/page.tsx` — 通知列表页面
- `components/layout/sidebar.tsx` — 修改：移除 NotificationPanel，新增通知菜单项 + 未读角标

### 修改

- `sidebar.tsx`：
  - 移除 `NotificationPanel` import 和渲染
  - 新增 `Bell` 图标菜单项
  - 侧边栏 mount 时获取未读数，显示角标

---

## 交互细节

1. **筛选联动**：切换筛选条件后，列表即时刷新（客户端筛选或重新请求）
2. **标记已读**：点击通知行或操作菜单中的「标记已读」，乐观更新 UI
3. **删除**：操作菜单中的「删除」，删除后从列表移除，更新统计数字
4. **批量操作**：「全部标记已读」和「删除已读」操作后，列表和统计数字同步更新
5. **角标更新**：在通知页面执行任何操作后，侧边栏角标数字同步更新
