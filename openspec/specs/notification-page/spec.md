## Requirements

### Requirement: Notification page as standalone sidebar menu item
系统 SHALL 在侧边栏导航中提供独立的通知菜单项，移除原有的铃铛下拉面板。

#### Scenario: Sidebar notification menu item
- **WHEN** 用户查看侧边栏导航
- **THEN** 可见"通知"菜单项（Bell 图标 + "通知"文字），位于监控中心之后

#### Scenario: Sidebar unread badge
- **WHEN** 存在 `is_read = false` 的通知
- **THEN** 通知菜单项右侧显示未读数量角标（红色圆形数字）

#### Scenario: No unread badge when all read
- **WHEN** 所有通知均已读或无通知
- **THEN** 通知菜单项不显示角标

#### Scenario: Sidebar badge refresh on navigation
- **WHEN** 用户从通知页面导航到其他页面
- **THEN** 侧边栏重新获取未读数并更新角标

---

### Requirement: Notification list page with statistics
系统 SHALL 提供独立的通知列表页面（`/notifications`），顶部展示统计卡片。

#### Scenario: Page displays statistics
- **WHEN** 用户访问通知页面
- **THEN** 顶部展示三个统计卡片：未读通知数、今日新增数、本周建议数

#### Scenario: Notification list displayed
- **WHEN** 通知页面加载完成
- **THEN** 按创建时间倒序展示通知列表，每条显示：未读圆点（未读时）、标题、策略名称标签（Badge）、创建时间

#### Scenario: Unread row visual distinction
- **WHEN** 通知为未读状态
- **THEN** 该行有浅色背景区分，左侧显示蓝色实心圆点

#### Scenario: Empty state
- **WHEN** 无任何通知
- **THEN** 页面居中显示"暂无通知"

---

### Requirement: Notification filtering
用户 SHALL 能够按已读状态和策略名称筛选通知。

#### Scenario: Filter by read status
- **WHEN** 用户切换已读状态筛选（全部 / 未读 / 已读）
- **THEN** 通知列表仅显示符合状态的通知

#### Scenario: Filter by strategy
- **WHEN** 用户在下拉框中选择某个策略
- **THEN** 通知列表仅显示该策略相关的通知

#### Scenario: Combined filtering
- **WHEN** 用户同时设置了状态筛选和策略筛选
- **THEN** 列表显示同时满足两个条件的通知

#### Scenario: Clear filters
- **WHEN** 用户重置筛选条件
- **THEN** 列表恢复显示所有通知

---

### Requirement: Notification batch operations
用户 SHALL 能够对通知执行批量操作。

#### Scenario: Mark all as read
- **WHEN** 用户点击"全部标记已读"按钮
- **THEN** 所有 `is_read = false` 的通知更新为已读，列表刷新，统计数字更新，角标清零

#### Scenario: Delete all read notifications
- **WHEN** 用户点击"删除已读"按钮
- **THEN** 所有 `is_read = true` 的通知被删除，列表刷新，统计数字更新

---

### Requirement: Single notification operations
用户 SHALL 能够对单条通知执行操作。

#### Scenario: Mark single notification as read
- **WHEN** 用户点击某条未读通知的操作菜单中的"标记已读"
- **THEN** 该通知更新为已读，列表中移除未读视觉标记，统计数字和角标更新

#### Scenario: Delete single notification
- **WHEN** 用户点击某条通知的操作菜单中的"删除"
- **THEN** 该通知从列表中移除，统计数字更新

#### Scenario: Click notification to navigate
- **WHEN** 用户点击某条通知行
- **THEN** 系统将该通知标记为已读，跳转到 `/monitoring?runId=<monitoringRunId>`

---

### Requirement: Enhanced notifications API
系统 SHALL 提供增强的通知 API，支持筛选、关联策略信息、统计和删除。

#### Scenario: GET /api/notifications with filtering
- **WHEN** 客户端请求 `GET /api/notifications?status=unread&strategyId=xxx`
- **THEN** 系统返回符合筛选条件的通知列表，每条包含 id、monitoringRunId、strategyId、strategyName、title、content、isRead、createdAt

#### Scenario: GET /api/notifications returns statistics
- **WHEN** 客户端请求 `GET /api/notifications`
- **THEN** 响应包含 unreadCount、todayCount、weekActionCount 统计字段

#### Scenario: DELETE /api/notifications/[id]
- **WHEN** 客户端请求 `DELETE /api/notifications/<id>`
- **THEN** 系统删除该通知记录并返回成功

#### Scenario: DELETE /api/notifications/read
- **WHEN** 客户端请求 `DELETE /api/notifications/read`
- **THEN** 系统删除所有 `is_read = true` 的通知并返回成功
