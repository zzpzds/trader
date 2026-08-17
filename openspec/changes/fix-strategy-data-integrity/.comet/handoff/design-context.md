# Comet Design Handoff

- Change: fix-strategy-data-integrity
- Phase: design
- Mode: compact
- Context hash: 4081583c683a2a339e9cd20f322ecd5b8504f0cfc950a2a77e9dda003b5cd85d

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/fix-strategy-data-integrity/proposal.md

- Source: openspec/changes/fix-strategy-data-integrity/proposal.md
- Lines: 1-30
- SHA256: 9075e3cea383a6de9c6664a24c1f510866e7c9fceefcf962dc3273c996afd5a9

```md
## Why

策略监控当前没有保留交易批次的 `BUY/SELL` 类型，导致卖出记录被当作新增持仓累计，AI 分析收到错误的持股数量和平均成本。同时，线上 AI 策略的标的列表、策略正文和原始脚本分别指向 AIQ 与 AMKR，热点检索与实际策略范围不一致。后续状态机和基本面监控必须建立在一致、可复算的数据之上，因此先修复这两个基础完整性问题。

## What Changes

- 让 Worker 监控按与 Web 持仓页面相同的交易回放规则处理 `BUY/SELL`，正确计算剩余持股、成本基础、平均成本和已实现盈亏。
- 在传给监控分析器的持仓批次中保留交易类型与稳定排序字段，避免卖出被当作买入。
- 为监控持仓回放增加覆盖“买入—全部卖出—重新买入”等路径的回归测试。
- 校验并修正目标 AI 策略的标的配置，使策略 `symbols`、描述、原始脚本和下游热点查询一致使用 AMKR，不再查询 AIQ。
- 不在本变更中新增基本面状态、H/B 双参考价、确定性交易引擎或官方证据管道。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `daily-monitoring`: 监控任务必须按交易类型回放持仓，并向分析器提供正确的剩余持股与成本。
- `position-management`: Web 与 Worker 必须对同一组买卖记录产生一致的持仓聚合结果。
- `news-hotspot`: 热点检索使用的策略标的列表必须与保存后的目标策略范围一致。

## Impact

- Worker：`apps/worker/src/monitoring/job.ts` 及对应测试。
- Web/共享领域逻辑：复用或提取现有持仓回放实现，避免 Web 与 Worker 口径分叉。
- 线上策略数据：在代码验证后通过现有策略 API 修正指定 AI 策略的 `symbols`，并同步正文/脚本中的 AMKR 配置；执行生产写入前单独确认。
- 不引入数据库 schema 变更，不连接券商，也不改变现有交易记录。

```

## openspec/changes/fix-strategy-data-integrity/design.md

- Source: openspec/changes/fix-strategy-data-integrity/design.md
- Lines: 1-59
- SHA256: 01f72ec26bdcb2e4fb8744a85d650f31a6757e27aee4e49dcb3367b8d6dc347c

```md
## Context

Web 端通过 `apps/web/lib/pnl.ts` 按时间顺序回放 `BUY/SELL` 交易，策略监控则在查询批次时丢弃 `type`，随后直接累加所有股数和金额。两套聚合口径已经分叉，任何包含卖出的策略都会向 LLM 提供错误上下文。与此同时，热点任务直接读取 `strategies.symbols`，目标 AI 策略的该字段仍含 AIQ，而描述已改为 AMKR。

## Goals / Non-Goals

**Goals:**

- 为 Web 与 Worker 提供单一、纯函数式的持仓回放实现。
- Worker 保留交易类型和创建时间，并使用回放结果生成监控持仓摘要。
- 用回归测试锁定买入、部分卖出、清仓和重新建仓的计算口径。
- 在代码验证后安全修正目标线上策略的 AMKR 配置，并复查热点查询范围。

**Non-Goals:**

- 不新增数据库字段或迁移。
- 不实现 H/B 双参考价、基本面红黄绿灯或确定性 T1/T2 引擎。
- 不改变移动平均成本法，也不引入 FIFO/LIFO 税务批次算法。
- 不自动部署或在未确认时写入生产数据。

## Decisions

### 1. 将交易回放提取为 `@trader/db` 的纯领域工具

把现有 Web 回放逻辑移动到 `packages/db` 的独立模块并导出，Web 与 Worker 均从同一入口调用。该函数只接收普通交易对象并返回聚合结果，不访问数据库。

选择这一方案是因为两个应用已经共同依赖 `@trader/db`，无需新增 workspace 包。备选方案是在 Worker 复制实现，但会继续保留未来口径漂移风险；新建领域包则对当前小范围修复过重。

### 2. Worker 查询完整交易语义后再聚合

`StrategyWithLots` 和数据库映射保留 `type`、`lotDate`、`createdAt`、股数与成交价。Worker 先调用共享回放函数得到 `heldShares`、`avgCost`、`realizedPnl`，再构造分析器输入。传给 LLM 的批次也保留买卖类型，避免详细分析误读历史。

### 3. 数据修正与代码部署分离

仓库变更负责消除计算错误并提供验证；线上 AI 策略通过现有 PUT API 做一次显式修正。生产写入前先 GET 快照并校验目标策略 ID，写入后再次 GET 验证 `symbols`、正文与脚本均已切换到 AMKR。该操作不写入数据库迁移，避免把环境特定 UUID 固化到 schema 历史中。

### 4. 下游标的范围仍以 `strategies.symbols` 为准

本变更不引入新的“自动从正文解析标的”逻辑。`symbols` 保持热点和价格任务的规范化机器字段；正文和脚本是用户可读/可追溯内容。通过原子保存和生产修正维持三者一致，而不是让运行时猜测正文含义。

## Risks / Trade-offs

- [共享工具移动可能影响 Web 导入路径] → 保留 Web 现有模块作为薄导出层，现有调用方无需一次性大改，并运行 Web 全量测试。
- [历史异常交易可能出现卖出超过当时持仓] → 保持现有回放语义，不在本修复中静默改写历史；测试覆盖正常受支持路径。
- [生产策略在代码完成前仍查询 AIQ] → 在交付说明中明确数据修正步骤；执行生产 PUT 前再次确认并保留 GET 快照。
- [脚本字段不会被 Worker 执行] → 本变更只同步其展示与追溯内容，不把脚本变成执行入口。

## Migration Plan

1. 先发布共享回放和 Worker 修复，运行 DB、Web、Worker 测试及构建。
2. GET 目标线上策略并保存变更前快照。
3. 经用户确认后，通过现有 PUT API 同步 `symbols`、正文和脚本中的 AMKR 配置。
4. 再次 GET 验证，并手动触发一次热点/监控任务确认下游范围。
5. 若生产数据修正有误，使用变更前快照通过同一 PUT API 回滚；代码修复可独立回滚且不涉及 schema。

## Open Questions

- 生产策略数据修正是否与本变更部署同一窗口执行，由实施完成后的上线确认决定。


```

## openspec/changes/fix-strategy-data-integrity/tasks.md

- Source: openspec/changes/fix-strategy-data-integrity/tasks.md
- Lines: 1-23
- SHA256: 2bfa62cc29101a62d558adb9390e2a41f7a9dbf5127410c2615a13ac5fb635ed

```md
## 1. 共享持仓回放

- [ ] 1.1 在 `@trader/db` 中提取并导出纯函数式交易回放类型与实现，保持现有移动平均成本语义
- [ ] 1.2 将 Web 的 P&L 模块切换为共享实现，并保持原有公共接口兼容
- [ ] 1.3 为共享回放补充部分卖出、全部卖出、重新建仓和示例交易序列测试

## 2. Worker 监控修复

- [ ] 2.1 扩展监控持仓查询与分析输入，保留 `type`、`createdAt` 和交易顺序信息
- [ ] 2.2 使用共享回放结果替换 Worker 对所有 lot 的直接正向求和
- [ ] 2.3 增加 Worker 回归测试，验证卖出不会增加持股或成本且 Web/Worker 结果一致

## 3. 标的配置一致性

- [ ] 3.1 增加热点任务测试，确认其严格按保存后的 `strategies.symbols` 生成查询
- [ ] 3.2 获取并校验目标线上 AI 策略的变更前快照，准备 AMKR 配置修正载荷
- [ ] 3.3 在生产写入获得确认后，通过现有 API 同步 `symbols`、正文和脚本，并回读验证不再引用 AIQ

## 4. 验证

- [ ] 4.1 运行 DB、Web 和 Worker 相关测试及类型构建
- [ ] 4.2 手动核对示例交易得到持股 5、均价 600、已实现盈亏 300
- [ ] 4.3 记录生产配置修正与回滚检查结果；未获生产写入确认时明确保留为上线步骤

```

## openspec/changes/fix-strategy-data-integrity/specs/daily-monitoring/spec.md

- Source: openspec/changes/fix-strategy-data-integrity/specs/daily-monitoring/spec.md
- Lines: 1-25
- SHA256: ebbe81fc476715fbcb399e68273b047753216f8169c3a2498c8dcf5e3f62aa52

```md
## ADDED Requirements

### Requirement: Transaction-aware monitoring position aggregation

策略监控任务 SHALL 按交易时间顺序和 `BUY/SELL` 类型回放每个 position 的全部交易，使用回放结果向分析器提供当前剩余持股、成本基础、平均成本和已实现盈亏，不得把卖出股数或卖出金额累计为持仓。

#### Scenario: Partial sell is deducted from monitoring holdings

- **WHEN** 某 position 先买入 10 股，再卖出 4 股
- **THEN** 监控分析器收到的当前持股 SHALL 为 6 股，平均成本 SHALL 按移动平均成本法计算

#### Scenario: Sell then re-entry is replayed correctly

- **WHEN** 某 position 依次买入 5 股 @ 600、卖出 5 股 @ 660、再买入 5 股 @ 600
- **THEN** 监控分析器收到的当前持股 SHALL 为 5 股、平均成本 SHALL 为 600、已实现盈亏 SHALL 为 300

#### Scenario: Transaction details retain their type

- **WHEN** Worker 将 position lots 转换为监控分析输入
- **THEN** 每条交易 SHALL 保留 `BUY` 或 `SELL` 类型以及稳定的日期/创建时间排序信息

#### Scenario: Fully sold position is represented safely in analysis

- **WHEN** 某 position 已完全卖出且之后没有重新建仓
- **THEN** 该 position SHALL 以当前持股 0、成本基础 0、已清仓状态和保留的已实现盈亏进入监控分析，提示词 SHALL NOT 计算当前持仓收益率或包含 `Infinity`、`NaN`

```

## openspec/changes/fix-strategy-data-integrity/specs/news-hotspot/spec.md

- Source: openspec/changes/fix-strategy-data-integrity/specs/news-hotspot/spec.md
- Lines: 1-16
- SHA256: c6bfc819e712be1b69e0bc0ba17e93fc0d99136a43b810cb9225a4f6c4ed97e3

```md
## ADDED Requirements

### Requirement: Canonical strategy symbols drive hotspot queries

热点任务 SHALL 以策略保存后的 `strategies.symbols` 作为机器可读的规范标的范围；目标策略完成标的替换时，保存操作和上线检查 MUST 确认标的列表与策略正文/脚本描述一致。

#### Scenario: Replaced symbol is used by hotspot search

- **WHEN** 目标 AI 策略已将 AIQ 替换为 AMKR 并保存 `symbols = [NVDA, GOOGL, MSFT, META, AMKR]`
- **THEN** 下一次热点任务 SHALL 生成 AMKR 查询且不得生成 AIQ 查询

#### Scenario: Production correction is verified after update

- **WHEN** 运维通过现有策略 API 修正目标策略配置
- **THEN** 系统 MUST 在写入后重新读取该策略并确认 `symbols`、正文和脚本均引用 AMKR 而非 AIQ


```

## openspec/changes/fix-strategy-data-integrity/specs/position-management/spec.md

- Source: openspec/changes/fix-strategy-data-integrity/specs/position-management/spec.md
- Lines: 1-16
- SHA256: a9d44aa1e502b635fac7f7caf77ddb3943b2dd86b0c799df56dbe2ba81b62f92

```md
## ADDED Requirements

### Requirement: Shared position replay semantics across applications

Web 持仓展示与 Worker 策略监控 SHALL 使用同一套交易回放语义，对相同交易序列产生一致的剩余持股、成本基础、平均成本、已实现盈亏和清仓状态。

#### Scenario: Web and Worker aggregate the same transactions

- **WHEN** Web 与 Worker 处理同一组包含 BUY 和 SELL 的交易记录
- **THEN** 两端得到的 `heldShares`、`costBasis`、`avgCost`、`realizedPnl` 与 `isClosed` SHALL 完全一致

#### Scenario: Fully sold position remains closed

- **WHEN** 累计卖出股数等于累计买入股数
- **THEN** Web 与 Worker 均 SHALL 返回持股 0、成本基础 0 和已清仓状态，且保留已实现盈亏


```
