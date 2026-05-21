## MODIFIED Requirements

### Requirement: Notification bell with unread count
系统 SHALL 在侧边栏导航菜单项中展示未读通知数量角标。

#### Scenario: Unread count displayed on menu item
- **WHEN** 存在 `is_read = false` 的通知
- **THEN** 侧边栏"通知"菜单项右侧显示未读数量角标（红色圆形数字）

#### Scenario: No unread notifications
- **WHEN** 所有通知均已读
- **THEN** 侧边栏"通知"菜单项不显示角标

---

### Requirement: View notification and mark as read
用户 SHALL 能够在独立通知页面查看通知并标记为已读。

#### Scenario: View notification list page
- **WHEN** 用户通过侧边栏点击"通知"菜单项
- **THEN** 系统展示独立通知列表页面（`/notifications`），显示标题、策略名称、时间、已读/未读状态，支持筛选和批量操作

#### Scenario: Navigate to monitoring run detail
- **WHEN** 用户点击某条通知
- **THEN** 系统将该通知标记为已读，跳转到 `/monitoring?runId=<monitoringRunId>`，监控中心页面自动展开对应运行记录

#### Scenario: Mark all as read
- **WHEN** 用户点击"全部标记已读"
- **THEN** 所有 `is_read = false` 的通知更新为已读，角标清零

## ADDED Requirements

### Requirement: Notification click navigates to specific monitoring run
系统 SHALL 在用户点击通知时精确跳转到对应的监控运行详情。

#### Scenario: Click notification navigates with runId
- **WHEN** 用户点击某条通知
- **THEN** 系统跳转到 `/monitoring?runId=<monitoringRunId>`，监控中心页面接收 runId 参数后自动定位并展开对应的 monitoring_run 记录
