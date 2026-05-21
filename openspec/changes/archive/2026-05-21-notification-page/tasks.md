## 1. API 增强

- [x] 1.1 增强 GET `/api/notifications`：新增 `status`（all/unread/read）和 `strategyId` query 参数，join monitoringRuns → strategies 返回 strategyId/strategyName，返回 unreadCount/todayCount/weekActionCount 统计字段
- [x] 1.2 新增 DELETE `/api/notifications/[id]` 路由：删除单条通知
- [x] 1.3 新增 DELETE `/api/notifications/read` 路由：批量删除所有已读通知

## 2. 侧边栏改造

- [x] 2.1 移除 NotificationPanel 组件引用：从 sidebar.tsx 中删除 NotificationPanel import 和渲染
- [x] 2.2 删除 notification-panel.tsx 及其测试文件
- [x] 2.3 新增通知菜单项：在 navItems 中添加 `{ href: "/notifications", label: "通知", icon: Bell }`，位于监控中心之后
- [x] 2.4 侧边栏未读角标：mount 时获取未读数，路由变化时刷新，未读为 0 时隐藏角标

## 3. 通知列表页面

- [x] 3.1 创建 `/notifications` 页面骨架：统计卡片区域 + 筛选/操作栏 + 通知列表
- [x] 3.2 统计卡片：未读通知数、今日新增数、本周建议数
- [x] 3.3 筛选功能：已读状态 Tab 切换（全部/未读/已读）+ 策略名称下拉筛选
- [x] 3.4 通知列表行：未读圆点、标题、策略名称 Badge、时间、操作菜单（标记已读/删除）
- [x] 3.5 批量操作：「全部标记已读」+ 「删除已读」按钮
- [x] 3.6 点击通知行：标记已读 + 跳转到 `/monitoring?runId=<monitoringRunId>`
- [x] 3.7 空状态：「暂无通知」居中提示

## 4. 监控中心适配

- [x] 4.1 监控中心页面接收 `runId` query 参数，自动定位并展开对应的 monitoring_run 记录
