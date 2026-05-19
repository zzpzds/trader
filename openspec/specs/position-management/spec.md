## ADDED Requirements

### Requirement: Add position lot
用户 SHALL 能够为策略下的任意股票新增一条买入批次（lot）记录。

#### Scenario: Add first lot for a new symbol
- **WHEN** 用户在策略详情持仓 Tab 中新增某股票的第一笔 lot
- **THEN** 系统自动创建对应的 position 记录（strategy_id + symbol），再创建 lot 记录，无需用户手动创建 position

#### Scenario: Add subsequent lot for existing symbol
- **WHEN** 用户为已有 position 的股票新增 lot
- **THEN** 系统在现有 position 下追加 lot 记录，position 记录不重复创建

#### Scenario: Lot fields required
- **WHEN** 用户提交新增 lot 表单
- **THEN** 系统要求 shares（股数）、cost_price（成本价）、lot_date（建仓日期）为必填项，notes 为可选

---

### Requirement: Edit position lot
用户 SHALL 能够修改已有 lot 的任意字段。

#### Scenario: Edit lot fields
- **WHEN** 用户修改某 lot 的股数、成本价、日期或备注并保存
- **THEN** 系统更新该 lot 记录，其他 lot 不受影响

---

### Requirement: Delete position lot
用户 SHALL 能够删除单条 lot 记录。

#### Scenario: Delete lot
- **WHEN** 用户删除某 lot 记录
- **THEN** 系统删除该 lot；若该 position 下已无任何 lot，position 记录保留（不自动删除）

---

### Requirement: View aggregated position
用户 SHALL 能够在持仓 Tab 中查看每只股票的聚合持仓信息。

#### Scenario: Aggregated display per symbol
- **WHEN** 用户查看策略详情持仓 Tab
- **THEN** 系统按 symbol 分组展示，每组显示：总股数（所有 lot shares 之和）、加权均价（按股数加权）、所有 lot 明细列表

---

### Requirement: Position P&L from monitoring snapshot
系统 SHALL 使用最近一次监控价格快照计算持仓浮动盈亏，不做实时拉取。

#### Scenario: P&L calculated from latest monitoring prices
- **WHEN** 用户查看持仓（策略详情持仓 Tab 或持仓管理总览页）
- **THEN** 系统从该策略最近一次 `status=completed` 的 monitoring_run.prices 取对应股票价格，计算 `盈亏% = (最近监控价 - 加权均价) / 加权均价 × 100` 并展示

#### Scenario: No monitoring data yet
- **WHEN** 该策略尚无任何 completed 的 monitoring_run
- **THEN** 最近监控价和盈亏列显示"--"

---

### Requirement: Positions overview page
用户 SHALL 能够在持仓管理总览页查看所有策略的持仓汇总。

#### Scenario: All positions listed
- **WHEN** 用户访问持仓管理页
- **THEN** 系统按策略分组展示所有策略的所有持仓，每条显示：股票代码、总股数、加权均价、最近监控价、浮动盈亏%

#### Scenario: Navigate to strategy detail
- **WHEN** 用户点击某条持仓记录
- **THEN** 系统跳转到对应策略详情页的持仓 Tab

---

### Requirement: Multi-symbol rebalancing via manual lots
用户 SHALL 能够通过手动增删 lot 记录表达换仓操作（减仓 A 买入 B）。

#### Scenario: Rebalancing between symbols
- **WHEN** 用户删除/减少 symbol A 的 lot，并为 symbol B 新增 lot
- **THEN** 系统分别更新两个 position 下的 lot 记录，正确反映换仓后的持仓状态
