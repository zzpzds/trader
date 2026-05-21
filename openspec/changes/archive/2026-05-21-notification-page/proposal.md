## Why

通知模块当前仅以侧边栏铃铛下拉面板形式存在，信息密度低、无法筛选和批量管理、点击跳转不精确（只到 /monitoring 而非具体 run）。需要升级为独立页面，与监控中心风格统一，增强通知的管理和展示能力。

## What Changes

- **移除**侧边栏铃铛下拉面板（`NotificationPanel` 组件及其测试）
- **新增**独立通知列表页面（`/notifications`），作为侧边栏菜单项
- **新增**通知列表页统计卡片（未读数、今日新增、本周建议数）
- **新增**筛选功能（已读状态切换 + 策略名称下拉筛选）
- **新增**批量操作（全部标记已读、删除已读）
- **新增**单条通知删除能力
- **新增**侧边栏菜单项未读角标
- **增强** GET `/api/notifications` 接口，支持筛选参数和关联策略信息
- **改进**点击通知跳转到对应监控运行详情（而非仅跳转到 /monitoring）

## Capabilities

### New Capabilities
- `notification-page`: 独立通知列表页面，含统计卡片、筛选、批量操作、单条删除

### Modified Capabilities
- `daily-monitoring`: 通知关联策略信息（GET /api/notifications 需 join monitoringRuns → strategies 返回 strategyId/strategyName），点击跳转到具体监控运行详情

## Impact

- **前端**：移除 `notification-panel.tsx`，新增 `/notifications` 页面，修改 `sidebar.tsx`
- **API**：增强 GET `/api/notifications`（新增筛选参数和关联字段），新增 DELETE 路由
- **数据库**：无变更
