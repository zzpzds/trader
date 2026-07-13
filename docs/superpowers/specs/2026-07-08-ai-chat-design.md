---
comet_change: add-ai-chat
role: technical-design
canonical_spec: openspec
archived-with: 2026-07-09-add-ai-chat
status: final
---

# AI Chat 技术设计

## 背景

本变更新增一个 Web 端全局投资组合 AI Chat。OpenSpec 的事实源是 `openspec/changes/add-ai-chat/`，本设计只细化实现方式。用户确认的范围是：全局投资组合问答、当前页面临时对话、允许明确买入/卖出/加仓/减仓建议、优先复用系统已有价格快照和近期价格、只返回文本，不新增实时行情、不持久化聊天、不自动下单。

当前代码已有：

- Web 端 Anthropic 兼容配置：`apps/web/lib/anthropic-config.ts`，当前只有 `PARSE` 场景。
- 策略、持仓、价格快照、记忆等表定义：`packages/db/src/schema.ts`。
- 记忆页面和 API 语义：记忆包含 `kind`、`strategyId`、`symbol`、`pinned`，可作为 prompt 背景。
- Worker monitoring 已有基于 Anthropic 兼容接口的投资分析模式，可复用其风险提示和上下文裁剪思路，但本次实现放在 Web 应用内。

## 总体方案

采用独立页面 + 无状态 API + 服务端上下文构造器。

新增 `/ai-chat` 页面负责当前页面会话状态。页面保留本次打开期间的消息列表，提交问题时把临时历史一起发送到 `POST /api/ai-chat`。刷新页面或重新进入页面后，前端 state 初始化为空，不从数据库恢复历史。

新增 `POST /api/ai-chat` 作为唯一模型调用入口。API 不信任客户端传入投资数据，只接收用户问题和临时消息历史，在服务端即时读取策略、未关闭持仓、最新可用价格、近期价格快照和有限记忆，构造中文 prompt 后调用 `CHAT` 场景模型，返回 `{ answer: string }`。

## 组件与文件

预期新增或修改：

- `apps/web/lib/anthropic-config.ts`：把 `AnthropicScenario` 扩展为 `"PARSE" | "CHAT"`，复用现有 chat-specific env fallback 规则。
- `apps/web/lib/ai-chat/context.ts`：新增组合上下文构造器，封装 DB 查询、裁剪、格式化和数据不足标记。
- `apps/web/lib/ai-chat/prompt.ts`：新增系统 prompt 和消息组装逻辑。
- `apps/web/app/api/ai-chat/route.ts`：新增 POST endpoint，做输入校验、调用上下文构造器和模型。
- `apps/web/app/ai-chat/page.tsx`：新增客户端聊天页面。
- 导航组件或布局文件：加入 “AI Chat” 或 “组合问答” 入口，具体跟随现有导航风格。
- 测试文件：围绕配置、上下文构造、API route 和页面交互增加覆盖。

不新增数据库表，不修改交易执行 API，不新增 worker 任务。

## API 合约

请求体：

```ts
type ChatRequest = {
  question: string;
  messages?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
};
```

约束：

- `question` trim 后不能为空，建议限制最大长度，例如 4000 字符。
- `messages` 只允许当前页面历史中的 user/assistant 文本，限制轮数和单条长度，例如最多最近 12 条、每条最多 4000 字符。
- API 忽略客户端传入的任何投资数据字段。

成功响应：

```ts
type ChatResponse = {
  answer: string;
};
```

错误响应：

```ts
type ChatError = {
  error: string;
};
```

状态码建议：

- `400`：输入为空、消息历史格式不合法或超出限制。
- `500`：模型配置缺失、模型调用失败或上下文构造异常。前端展示中文可理解错误，不展示内部 stack。

## 上下文构造

`buildPortfolioChatContext()` 返回结构化对象，再由 prompt 层格式化为文本。建议对象包含：

```ts
type PortfolioChatContext = {
  generatedAt: string;
  strategies: StrategyContext[];
  positions: PositionContext[];
  prices: PriceContext[];
  memories: MemoryContext[];
  limitations: string[];
};
```

策略上下文：

- 读取策略名称、symbols、策略内容摘要。
- 控制数量和每条内容长度，避免把完整长策略无裁剪塞进 prompt。

持仓上下文：

- 只包含未关闭持仓作为当前组合主体。
- 包含 symbol、总股数、均价、参考价、最新可用价格、浮动盈亏、相关交易摘要。
- 如果 latest price 缺失，记录到 `limitations`，不要让模型猜当前价格。

价格上下文：

- 复用已有 price snapshots/recent prices，不主动拉取实时行情。
- 每个 symbol 取最新快照作为“最新可用价格”，再取有限近期 close 序列，例如最近 10 条。
- prompt 中明确“这些是系统已有快照，不保证实时”。

记忆上下文：

- 注入少量置顶、symbol 相关、strategy 相关或最近更新的记忆。
- 参考 worker 已有裁剪思路：置顶优先、近期优先、按内容长度截断、设置总条数和总字符上限。
- 记忆在 prompt 中必须标为“用户背景/偏好/复盘/笔记”，不得标为行情事实。
- 当记忆和当前持仓、策略或价格快照冲突时，prompt 要求模型以当前组合数据和价格快照为准，把记忆当作历史背景。

## Prompt 策略

系统 prompt 使用中文，目标是得到可读文本回答，而不是 JSON。核心规则：

- 明确模型是投资组合分析助手，回答应基于提供的系统数据。
- 允许给出明确“买入、卖出、加仓、减仓、持有/观望”等建议。
- 给建议时必须说明依据、关键风险、数据时效和不确定性。
- 如果缺少持仓、价格、策略或足够历史数据，必须指出缺口，不能把缺失数据编造成事实。
- 不声称使用实时行情，不声称已执行交易。
- 不输出工具调用或结构化交易指令。

消息组装顺序：

1. system：角色、边界、安全约束和回答风格。
2. user/context：当前组合上下文、limitations、记忆背景。
3. history：当前页面最近消息历史。
4. user：本次问题。

这样既保留临时追问能力，又让服务端当前组合上下文优先于旧对话。

## 前端交互

`/ai-chat` 是工作型页面，不做营销式落地页。布局建议：

- 顶部为简洁标题和当前能力范围提示，例如“基于系统已有组合数据和价格快照回答”。
- 主区域为消息流，用户消息和助手消息清晰区分。
- 底部固定或自然贴底输入区，包含 textarea 和带发送图标的按钮。
- 发送中禁用按钮并显示加载状态。
- 错误以消息流内的错误文本或输入区上方提示展示。
- 空状态给一个简短占位和示例问题，但不写长篇说明。

页面 state 只存在 React state 中，不写 localStorage/sessionStorage，不调用任何 chat history API。

## 风险与边界

- 投资建议风险：允许明确建议，但 prompt 必须要求依据和风险，不把建议表达为确定收益。
- 数据陈旧风险：价格来自已有快照，回答必须暴露时效边界。
- Prompt 过大：策略、价格、记忆和历史都必须有条数和字符限制。
- 旧记忆误导：记忆只能作为背景，当前持仓和价格快照优先级更高。
- 模型不可用：配置缺失或调用失败时返回可理解错误，不影响其他页面。
- 无状态代价：每次请求重新聚合上下文，后续如果性能不足可缓存上下文摘要，但不在本次范围内。

## 测试策略

单元测试：

- `getAnthropicConfig("CHAT")` 使用 `ANTHROPIC_*_CHAT`，并能回退通用 env 和默认模型。
- 上下文构造器能读取策略、未关闭持仓、最新价格和近期价格。
- 数据缺失时生成 `limitations`，不会产生伪造价格。
- 记忆注入有数量/长度上限，并在格式化文本中标为背景。
- prompt 包含“非实时价格”“可给出明确建议但说明风险”“不自动下单”等关键边界。

API 测试：

- 空问题返回 400。
- 合法请求调用上下文构造和模型，返回文本。
- 当前页面历史会传给模型，但只保留允许的 role 和长度。
- 模型配置缺失或调用失败返回中文错误。
- API 不写入 chat history，不调用交易执行相关逻辑。

页面测试：

- 用户输入问题后展示用户消息、加载状态和助手回答。
- 追问时提交历史。
- API 错误时展示可理解错误。
- 重新挂载页面时消息列表为空。

验证：

- 运行相关 Web/DB 定向测试。
- 运行 `openspec validate add-ai-chat --strict`。
- 手动确认回答不声称实时价格、不持久化对话、不执行交易。

## 回滚

回滚可以移除 `/ai-chat` 页面、导航入口、`/api/ai-chat` route 和 `CHAT` 配置扩展。由于不新增表、不写聊天历史、不触碰交易执行数据，回滚不需要数据迁移。
