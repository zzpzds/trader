# Comet Design Handoff

- Change: add-ai-chat
- Phase: design
- Mode: compact
- Context hash: 94034c2cab61cd4f2ad4136c06b07acefae8bac9cd60f5d13858bdb70edd1095

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/add-ai-chat/proposal.md

- Source: openspec/changes/add-ai-chat/proposal.md
- Lines: 1-30
- SHA256: 15466a74fa041ca82d75b961ec155463cef262c446f7a2c27dc1c3c960bc3f5f

```md
## Why

当前系统已经具备策略、持仓、价格快照、监控分析和交易洞察能力，但用户需要以自然语言直接询问全局投资组合问题，并获得基于现有数据的股票分析和操作建议。新增 AI Chat 可以把已有投资上下文转化为即时问答体验，降低查看多个页面和手动综合判断的成本。

## What Changes

- 新增 Web 端 AI Chat 页面，用于当前页面内的临时全局投资组合问答。
- 新增 chat API，接收用户问题和本页临时对话历史，构造全局投资组合上下文并调用 Anthropic 兼容模型。
- Chat 回答仅返回文本，允许给出明确买入、卖出、加仓、减仓建议，并应说明依据和风险。
- 上下文优先复用系统已有策略、持仓、价格快照/近期价格等数据。
- 数据不足、模型配置缺失或模型调用失败时，提供可理解的错误或数据不足说明。
- 不保存聊天会话历史，刷新页面后对话清空。
- 不新增实时行情供应商，不自动下单，不做工具调用式回答。

## Capabilities

### New Capabilities
- `ai-chat`: 提供基于全局投资组合上下文的临时 AI 问答能力，支持文本分析和明确交易建议。

### Modified Capabilities

无。

## Impact

- 影响 Web 前端页面与导航：新增 AI Chat 入口和聊天界面。
- 影响 Web API：新增 chat endpoint，用于构造上下文并调用模型。
- 影响模型配置：需要支持 chat 场景的 Anthropic 兼容模型配置，优先沿用现有环境变量约定。
- 影响数据读取：复用现有数据库中的策略、持仓、价格快照/近期价格数据。
- 影响测试：新增 chat API、上下文构造和前端临时对话行为的覆盖。

```

## openspec/changes/add-ai-chat/design.md

- Source: openspec/changes/add-ai-chat/design.md
- Lines: 1-83
- SHA256: 5a8b10573e52e1594025f1ba32e889c877fe40c8887384022b84f302717bb5f5

[TRUNCATED]

```md
## Context

系统当前已有策略管理、持仓管理、价格快照、监控分析、新闻、记忆和交易洞察等能力。定时监控 worker 已经通过 Anthropic 兼容接口基于策略、持仓和近期价格生成中文分析，但用户还缺少一个可主动提问的全局投资组合问答入口。

本次新增 AI Chat 面向 Web 应用中的当前页面会话：用户输入自然语言问题，前端把本页临时消息历史提交给后端，后端读取现有投资组合上下文并调用模型，返回纯文本回答。

## Goals / Non-Goals

**Goals:**

- 提供一个 Web 端 AI Chat 页面，用于全局投资组合问答。
- Chat API 能读取系统已有策略、持仓、价格快照/近期价格，构造模型上下文。
- 模型回答使用中文文本，允许给出明确买入、卖出、加仓、减仓建议。
- 支持当前页面内的连续追问，刷新页面后对话清空。
- 在数据不足、模型配置缺失或模型调用失败时提供可理解反馈。

**Non-Goals:**

- 不持久化聊天会话，不新增 chat 数据表。
- 不自动下单，不连接交易执行系统。
- 不新增实时行情供应商，不由 chat 强制拉取外部实时行情。
- 不实现工具调用式回答或结构化交易指令执行。
- 不引入新的多用户权限、审计或合规审批能力。

## Decisions

### 独立 AI Chat 页面

新增独立 Web 页面作为主入口，并在现有导航中加入入口。这样用户可以从任意投资管理流程进入全局问答，不需要把聊天 UI 嵌入某个特定策略或洞察页面。

备选方案是在监控或洞察页内嵌入 Chat，但这会让能力看起来只服务于单个页面，并限制后续扩展。独立页面更符合“全局投资组合问答”的范围。

### 单个无状态 Chat API

新增 `POST /api/ai-chat` 风格的 API，接收：

- 当前用户输入。
- 当前页面临时消息历史。

API 不保存消息，只在每次请求中使用客户端传来的历史和服务端即时读取的投资组合上下文生成回答。这样可以满足临时对话需求，并避免新增数据库迁移。

### 后端聚合投资上下文

Chat API 在服务端聚合上下文，优先包含：

- 策略名称、标的、策略内容摘要。
- 当前未关闭持仓、总股数、均价、参考价、最新可用价格、浮动盈亏。
- 每个相关 symbol 的近期价格快照，例如最近 10 条 close 数据。
- 必要时包含少量全局或置顶记忆，作为背景补充。

上下文应设置数量和长度上限，避免 prompt 过大。若关键数据缺失，prompt 必须显式说明“暂无可用价格/持仓/策略数据”，要求模型不要编造行情。

### 使用 Anthropic 兼容模型配置

沿用项目已有 Anthropic 兼容客户端和环境变量约定。Web 端当前只有 `PARSE` 场景，新增 chat 场景时应扩展为 `CHAT`，并支持：

- `ANTHROPIC_API_KEY_CHAT`
- `ANTHROPIC_BASE_URL_CHAT`
- `ANTHROPIC_MODEL_CHAT`
- 回退到通用 `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL`

这样可以独立调整 chat 模型，同时不破坏已有解析和 worker 任务配置。

### 文本回答，不做工具调用

本次只返回模型文本回答。系统 prompt 约束模型回答尽量包含“结论、依据、建议、风险”，但 API 不要求结构化 JSON 工具结果。这样实现成本低，满足用户“只回答文本”的明确边界。

## Risks / Trade-offs

- 模型建议可能被误解为确定性投资指令 -> 在系统 prompt 中要求回答说明依据、风险和数据时间范围，并在数据不足时拒绝给出强建议。
- 上下文过大导致请求失败或成本升高 -> 对策略、持仓、记忆和近期价格数量设置上限，只注入全局问答所需摘要。
- 价格快照不是实时行情 -> 回答必须标明基于系统已有价格快照/近期价格，不声称实时价格。
- 临时会话刷新丢失 -> UI 明确按当前页面状态管理，不提供历史恢复入口。
- API 调用依赖模型环境变量 -> 缺失配置时返回明确错误，前端展示可理解状态。

## Migration Plan

无需数据库迁移。部署时新增页面、API 和模型配置支持即可。若上线后需要回滚，可以移除导航入口并回退新增 API/页面代码，不影响已有策略、持仓、监控和洞察数据。

## Open Questions

```

Full source: openspec/changes/add-ai-chat/design.md

## openspec/changes/add-ai-chat/tasks.md

- Source: openspec/changes/add-ai-chat/tasks.md
- Lines: 1-26
- SHA256: 5d3543b1630679024bb66a1d4354784cd88c8c69e95bf90f8d12c7e7b0008b29

```md
## 1. 上下文与模型层

- [ ] 1.1 扩展 Web 端 Anthropic 兼容模型配置，新增 `CHAT` 场景并保留通用配置回退行为。
- [ ] 1.2 实现组合 chat 上下文构造器，读取策略、未关闭持仓、最新可用价格、近期价格快照和有限的相关记忆上下文。
- [ ] 1.3 增加面向中文文本回答的 prompt 构造，覆盖数据时效、操作建议、依据和风险提示。
- [ ] 1.4 为 chat 上下文构造、缺失数据处理和 chat 模型配置回退增加单元测试。

## 2. Chat API

- [ ] 2.1 新增 POST chat API endpoint，校验用户输入和当前页面消息历史。
- [ ] 2.2 使用生成的组合上下文和临时消息历史调用 Anthropic 兼容模型。
- [ ] 2.3 成功时返回文本回答；配置缺失、输入不足或模型调用失败时返回可理解的错误响应。
- [ ] 2.4 增加 API route 测试，覆盖成功回答、校验失败、数据不足行为和模型失败处理。

## 3. Web Chat 体验

- [ ] 3.1 新增 AI Chat 导航入口和页面路由。
- [ ] 3.2 构建 AI Chat 页面，包含当前页面消息历史、输入区、发送控件、加载状态和错误状态。
- [ ] 3.3 将对话状态仅保存在页面内，刷新或重新打开页面后从空对话开始。
- [ ] 3.4 增加组件或页面测试，尽量覆盖发送问题、展示回答、追问历史提交、错误展示和刷新重置行为。

## 4. 验证

- [ ] 4.1 运行与 chat 上下文、API 和 UI 相关的 Web 与 DB 定向测试。
- [ ] 4.2 运行 `add-ai-chat` 的 OpenSpec 校验。
- [ ] 4.3 手动验证 chat 回答使用已有组合数据、不声称实时价格，并且不会持久化消息。

```

## openspec/changes/add-ai-chat/specs/ai-chat/spec.md

- Source: openspec/changes/add-ai-chat/specs/ai-chat/spec.md
- Lines: 1-77
- SHA256: fa5d90d9409e68fc8413f6885668bc5e21aae93232cd04bc910926750341b279

```md
## ADDED Requirements

### Requirement: Global portfolio chat page
The system SHALL provide a Web page for AI chat over the global portfolio.

#### Scenario: User opens the chat page
- **WHEN** the user navigates to the AI Chat entry
- **THEN** the system displays a chat interface with an input area, send control, and message history for the current page session

#### Scenario: Page refresh clears temporary conversation
- **WHEN** the user refreshes or reopens the AI Chat page
- **THEN** the system starts with an empty conversation and does not restore prior chat messages

### Requirement: Text-only portfolio question answering
The system SHALL allow the user to ask global portfolio questions and receive text answers from the configured model.

#### Scenario: User asks a portfolio question
- **WHEN** the user submits a non-empty question
- **THEN** the system sends the question and current page message history to the chat API
- **AND** the system displays the returned text answer in the conversation

#### Scenario: User follows up in the same page session
- **WHEN** the user asks a follow-up question after receiving an answer
- **THEN** the system includes the current page message history so the answer can reference prior turns

### Requirement: Portfolio context injection
The chat API SHALL construct model context from existing portfolio data before calling the model.

#### Scenario: Portfolio data exists
- **WHEN** strategies, open positions, and price snapshots exist in the database
- **THEN** the chat API includes relevant strategy, position, latest available price, and recent price snapshot context in the model request

#### Scenario: Portfolio data is insufficient
- **WHEN** required portfolio context is missing or insufficient for the question
- **THEN** the system returns an answer or error state that explains the data limitation and does not fabricate missing market data

### Requirement: Memory context as bounded background
The chat API SHALL inject only bounded memory context and SHALL present memories as background notes rather than market facts.

#### Scenario: Memories are included in chat context
- **WHEN** pinned, strategy-related, symbol-related, or recent memories are available for the portfolio
- **THEN** the chat API limits the number and total length of injected memories
- **AND** the model context labels memories as user background, preferences, reviews, or notes rather than current market data

#### Scenario: Memory content conflicts with current portfolio data
- **WHEN** injected memory content conflicts with current strategy, position, or price snapshot data
- **THEN** the model answer treats the current portfolio and price snapshot data as more authoritative than memory notes

### Requirement: Trading recommendation support
The chat API SHALL permit the model to provide explicit buy, sell, add, or reduce recommendations when supported by available context.

#### Scenario: Recommendation can be made
- **WHEN** the user asks whether the portfolio should be adjusted and sufficient context exists
- **THEN** the model answer may include explicit buy, sell, add, or reduce recommendations with supporting rationale and risks

#### Scenario: Recommendation lacks data support
- **WHEN** the available context is insufficient to support a specific trading recommendation
- **THEN** the model answer indicates the missing data and avoids presenting unsupported actions as facts

### Requirement: No chat persistence or execution side effects
The system SHALL keep AI Chat conversations temporary and SHALL NOT execute trades or persist chat history.

#### Scenario: Chat response is generated
- **WHEN** the chat API returns an answer
- **THEN** the system does not create chat history records in the database
- **AND** the system does not create, modify, or execute any trade orders

### Requirement: Model configuration and error handling
The system SHALL use Anthropic-compatible model configuration for AI Chat and expose understandable errors when the model cannot be called.

#### Scenario: Chat model configuration is available
- **WHEN** chat-specific or shared Anthropic-compatible environment variables are configured
- **THEN** the chat API uses them to call the model

#### Scenario: Model call fails
- **WHEN** model configuration is missing or the model request fails
- **THEN** the API returns an error response and the UI displays an understandable failure message

```
