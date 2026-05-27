# 移动端适配设计

**日期：** 2026-05-26
**范围：** `apps/web` 全部页面及布局组件

---

## 背景

当前前端仅适配桌面端：左侧固定 224px 侧边栏 + 右侧限宽内容区，无任何响应式断点。需要在手机上可用。

---

## 决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 目标设备 | 手机优先 | 用户主要在手机上查看持仓和通知 |
| 导航模式 | 底部图标+文字 Tab 栏 | 单手操作友好，4 项导航刚好适合底部 Tab |
| 代码组织 | 原地响应式（Tailwind 断点类） | 改动集中，不引入新抽象，与现有风格一致 |
| 整体方案 | 分层改造（布局层 + 页面层） | 每页独立可增量交付 |
| 持仓展示 | 卡片列表（非表格） | 手机上信息密度适中，批次详情内嵌无需展开 |
| 统计网格 | 2x2 网格 | 全部数据一目了然，无需横向滑动 |

---

## 架构

### 断点

使用 Tailwind 默认断点 `md`（768px）作为分界：
- `< 768px`：手机布局（底部 Tab，全宽内容，卡片列表）
- `>= 768px`：桌面布局（侧边栏，限宽内容，表格）

### 改造分层

1. **布局层**：`layout.tsx` + `sidebar.tsx` + 新 `mobile-nav.tsx`
2. **页面层**：5 个页面逐页加响应式类

---

## 布局层

### `layout.tsx` 改造

- `<Sidebar>` 加 `hidden md:flex`，桌面端保持 224px 侧边栏
- 新增 `<MobileNav>` 组件，加 `flex md:hidden`
- `<main>` 加 `pb-16 md:pb-0`，为底部 Tab 留 56px 空间

### `MobileNav` 组件

新文件 `components/layout/mobile-nav.tsx`：

- `fixed bottom-0 inset-x-0`，高度 56px，白底 + 上边框
- 4 个 Tab：策略库（BookOpen）、持仓管理（BarChart3）、监控中心（Eye）、通知（Bell）
- 图标 + 文字标签，当前路由高亮
- 通知 Tab 显示未读数 Badge（复用 Sidebar 的 fetchUnread 逻辑）

### `Sidebar` 微调

仅加 `hidden md:flex`，内部逻辑不变。

---

## 页面层

### 通用规则

- 外层 `max-w-4xl` → `max-w-none md:max-w-4xl`
- 外层 `p-6` → `p-4 md:p-6`

### 策略库页 (`strategies/page.tsx`)

- 标题 + 按钮行：加 `flex-wrap`，手机上按钮占满宽度
- 其余单列卡片天然适配，无需改动

### 策略详情页 (`strategies/[id]/page.tsx`)

- 标题区：`flex-wrap`，名称和 Badge 换行，「立即分析」按钮移到下一行
- 内 Tab 栏：加 `overflow-x-auto`，手机上可横向滚动
- 持仓 Tab：
  - 每个持仓渲染为卡片（`rounded-lg border bg-card`），替代表格
  - 卡片头部：标的 + 股数/均价 + 价格/收益
  - 卡片体：批次详情内嵌，每行显示日期/股数/成本价/备注/删除按钮
- 新增批次表单：`grid-cols-2` → `grid-cols-1 md:grid-cols-2`
- 描述编辑、脚本重新解析面板：天然适配，无需改动

### 持仓管理页 (`positions/page.tsx`)

- PnL Chart：手机上全宽
- 持仓卡片内容行：`flex-wrap`，价格和收益换行

### 监控中心页 (`monitoring/page.tsx`)

- 统计网格 `grid-cols-4` → `grid-cols-2 md:grid-cols-4`
- 筛选 Select：`w-48` → `w-full md:w-48`
- 运行记录卡片：手机上日期/策略名与 Badge/删除按钮换行

### 通知页 (`notifications/page.tsx`)

- 统计网格 `grid-cols-3` → `grid-cols-2 md:grid-cols-3`（2+1 布局）
- 筛选栏：`flex-wrap`，按钮组换行
- 通知卡片：手机上时间戳和操作按钮换行

---

## 测试

- `MobileNav`：独立单元测试，验证 4 个 Tab 渲染、当前路由高亮、未读 Badge
- 页面响应式：不写专门测试（Tailwind CSS 类驱动，JSDOM 无法模拟视口宽度）
- 现有测试不受影响

---

## 不在范围内

- PWA / 离线支持
- 触摸手势（滑动删除等）
- 横屏专门适配
- 深色模式
- 桌面端现有布局的改动
