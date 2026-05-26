# 策略修改功能设计

**日期：** 2026-05-26  
**范围：** `apps/web/app/strategies/[id]/page.tsx` 及相关 API

---

## 背景

当前策略详情页的「策略描述」和「原始脚本」Tab 均为只读。用户需要能够：

1. 直接编辑策略描述（`content` 字段）
2. 上传新版脚本重新解析，更新 name、symbols、content、script 四个字段

后端 `PUT /api/strategies/[id]` 已支持这些字段的更新，只需添加 UI 入口。

---

## 架构

所有变更集中在一个文件：`apps/web/app/strategies/[id]/page.tsx`。不新增 API 路由，复用现有 `PUT /api/strategies/[id]` 和 `POST /api/strategies/parse`。

---

## 功能一：策略描述行内编辑

### 交互流程

1. `description` Tab 右上角增加「编辑」按钮（`Edit2` 图标）
2. 点击后，渲染的 Markdown 区域替换为 Textarea（`min-h-[300px]`，monospace 字体，预填当前 `content`）
3. 按钮组变为「保存」＋「取消」
4. 点「保存」→ `PUT /api/strategies/[id]` 仅传 `{ content: descriptionInput }`；成功后刷新 `strategy.content`，切回预览模式；失败显示错误提示
5. 点「取消」→ 丢弃修改，切回预览模式，不发请求

### 新增状态变量

| 变量 | 类型 | 说明 |
|------|------|------|
| `editingDescription` | `boolean` | 是否处于编辑模式 |
| `descriptionInput` | `string` | 编辑中的文本内容 |
| `savingDescription` | `boolean` | 保存请求进行中 |

---

## 功能二：原始脚本重新解析

### 交互流程

1. `script` Tab 复制按钮旁增加「重新解析」按钮（`RefreshCw` 图标）
2. 点击后 Tab 内展开折叠面板，包含「上传文件」/「粘贴代码」两个子 Tab（与策略列表页注入面板逻辑一致）
3. 点「解析脚本」→ `POST /api/strategies/parse`；解析成功后展示预览确认区：
   - 可编辑的 `name` 输入框（预填解析结果）
   - 可编辑的 `symbols` 标签组（预填解析结果）
   - 新描述 Markdown 预览（只读）
4. 点「确认更新」→ `PUT /api/strategies/[id]` 传 `{ name, symbols, content, script }`；成功后：
   - 折叠面板关闭并重置
   - 刷新 `strategy` 数据
   - 自动切换到 `description` Tab 以直观展示新内容
5. 点「取消」→ 收起面板，不发请求

### 新增状态变量

| 变量 | 类型 | 说明 |
|------|------|------|
| `showReparse` | `boolean` | 是否显示重新解析面板 |
| `reparseTab` | `"upload" \| "paste"` | 子 Tab 选择 |
| `reparseScript` | `string` | 新脚本内容 |
| `reparseParsed` | `ParsedStrategy \| null` | 解析结果（复用现有类型） |
| `reparseEditName` | `string` | 可编辑的策略名称 |
| `reparseEditSymbols` | `string[]` | 可编辑的股票代码列表 |
| `reparsing` | `boolean` | 解析请求进行中 |
| `savingReparse` | `boolean` | 保存请求进行中 |

---

## 错误处理

- 描述保存失败：`alert("保存失败，请重试")`，保持编辑模式
- 脚本解析失败：`alert(data.error)` 或网络错误提示，保持输入状态
- 脚本保存失败：`alert("更新失败，请重试")`，保持预览确认区

---

## 不在范围内

- name、symbols 的独立编辑入口（name 已有顶部重命名；symbols 修改通过重新解析脚本触发）
- 描述编辑的 Markdown 实时预览（行内 Textarea 已足够，全预览超出当前需求）
- 版本历史 / 回滚
