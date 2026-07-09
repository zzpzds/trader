## Requirements

### Requirement: Add position lot
用户 SHALL 能够为策略下的任意股票新增一条买入批次（lot）记录。

#### Scenario: Add first lot for a new symbol
- **WHEN** 用户在策略详情持仓 Tab 中新增某股票的第一笔 lot
- **THEN** 系统自动创建对应的 position 记录（strategy_id + symbol），将 reference_price 设为该 lot 的 cost_price，再创建 lot 记录，无需用户手动创建 position

#### Scenario: Add subsequent lot for existing symbol
- **WHEN** 用户为已有 position 的股票新增 lot
- **THEN** 系统在现有 position 下追加 lot 记录，position 记录和 reference_price 均不变

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
用户 SHALL 能够删除单条交易记录(买入或卖出),删除买入受持股非负守卫约束。

#### Scenario: Delete lot
- **WHEN** 用户删除某条交易记录
- **THEN** 系统删除该记录;若该 position 下已无任何记录,position 记录保留(不自动删除);删除买入若会导致历史持股为负则拒绝(HTTP 409)

---

### Requirement: View aggregated position
用户 SHALL 能够在持仓 Tab 中查看每只股票的聚合持仓信息,均价按移动平均口径回放交易得出。

#### Scenario: Aggregated display per symbol
- **WHEN** 用户查看持仓 Tab
- **THEN** 系统按 symbol 分组展示,每组显示:剩余持股(回放后的 `heldShares`)、移动平均成本(`costBasis/heldShares`)、该股票的完整操作历史时间线(BUY/SELL,`transactions`)

#### Scenario: Closed symbol aggregation
- **WHEN** 某 symbol 已清仓(剩余持股为 0)
- **THEN** 系统展示剩余持股 0、标「已清仓」,均价不再展示,操作历史仍完整保留

---

### Requirement: Record sell transaction
用户 SHALL 能够为已有持仓的股票记录一笔卖出。系统通过共享 `recordSell` service 在对应 position 下插入一条 `type='SELL'` 的 `position_lots` 记录(`shares`=卖出股数、`costPrice`=卖出价、`lotDate`=卖出日期、`notes`=备注)。手动持仓与策略持仓两处行为一致。

#### Scenario: Sell within held shares
- **WHEN** 用户对某股票提交卖出,卖出股数 ≤ 该股票当前剩余持股
- **THEN** 系统插入一条 `type='SELL'` 的记录,并据移动平均口径累加该笔已实现盈利

#### Scenario: Oversell rejected
- **WHEN** 用户提交的卖出股数 > 当前剩余持股
- **THEN** 系统拒绝(HTTP 400),不插入记录,不允许做空/超卖

#### Scenario: Sell date earlier than first buy rejected
- **WHEN** 卖出日期早于该股票最早一笔买入日期
- **THEN** 系统拒绝(HTTP 400)

#### Scenario: Sell field validation
- **WHEN** 用户提交卖出表单,股数 ≤ 0、价格 ≤ 0 或卖出日期晚于今天
- **THEN** 系统拒绝(HTTP 400)

---

### Requirement: Operation history timeline
持仓卡片下方 SHALL 统一展示该股票的买入/卖出操作历史时间线,按日期排序,每行标明类型、股数、价格,买入/卖出用文字标签 + 颜色区分(红涨绿跌)。

#### Scenario: Timeline lists buys and sells chronologically
- **WHEN** 用户查看某持仓卡片
- **THEN** 系统展示该 position 下所有 `position_lots`(BUY 与 SELL)按 `lotDate` 升序排列,每行显示日期、「买入/卖出」标签、股数、价格、备注

#### Scenario: Each transaction row deletable
- **WHEN** 用户在某条操作历史记录上点击删除
- **THEN** 系统删除该条记录(受 delete-buy 守卫约束)

---

### Requirement: Closed position retained
全部卖出后 SHALL 保留 position 为「已清仓」,而非隐藏或删除。已清仓持仓仍计入账户/策略总收益。

#### Scenario: Position marked closed when fully sold
- **WHEN** 某股票累计卖出股数等于累计买入股数(剩余持股为 0)
- **THEN** 系统标记该 position `isClosed=true`,卡片显示「已清仓」徽章,价格列不再轮询,总盈利等于累计已实现盈利

---

### Requirement: Guard deletion that would make holdings negative
删除一笔买入 SHALL 在会导致历史上某日持股为负时被拒绝;删除卖出始终安全。

#### Scenario: Delete buy rejected when it would cause negative holdings
- **WHEN** 用户删除某笔 BUY,且回放剩余交易会使历史上某日持股为负
- **THEN** 系统拒绝(HTTP 409),不删除该记录

#### Scenario: Delete buy allowed when safe
- **WHEN** 删除某笔 BUY 后回放任意时点持股均 ≥ 0
- **THEN** 系统删除该记录

#### Scenario: Delete sell always allowed
- **WHEN** 用户删除某笔 SELL
- **THEN** 系统删除该记录,不做持股非负校验

---

### Requirement: Position P&L from monitoring snapshot
系统 SHALL 使用 `price_snapshots` 表中该 symbol 的最新一行 `close` 计算持仓浮动盈亏,不做实时拉取。

#### Scenario: P&L calculated from latest price_snapshots row
- **WHEN** 用户查看持仓(策略详情持仓 Tab 或持仓管理总览页)
- **THEN** 系统对每只 symbol 取 `SELECT close FROM price_snapshots WHERE symbol = ? ORDER BY date DESC LIMIT 1`,计算 `盈亏% = (最新价 - 加权均价) / 加权均价 × 100` 并展示

#### Scenario: No price snapshot yet
- **WHEN** 该 symbol 在 `price_snapshots` 中尚无任何行
- **THEN** 最新价和盈亏列显示"--",不影响其他 symbol 的展示

---

### Requirement: Positions overview page
用户 SHALL 能够在持仓管理总览页查看所有持仓汇总,页面顶部展示账户级总览与历史曲线,下方按 tab 分组展示「策略持仓」与「手动持仓」。

#### Scenario: Account-level summary and chart at top
- **WHEN** 用户访问 `/positions`
- **THEN** 系统在顶部展示「总持仓收益」汇总卡片与全量历史收益率折线图,数据**包含**所有策略持仓和手动持仓,与 tab 切换无关

#### Scenario: Strategy positions tab lists by strategy
- **WHEN** 用户处于 `/positions?tab=strategies`(默认)
- **THEN** 系统在曲线下方按策略分组展示所有 `strategy_id IS NOT NULL` 的持仓,每条显示:股票代码、总股数、加权均价、最新价、浮动盈亏%

#### Scenario: Manual positions tab lists null-strategy holdings
- **WHEN** 用户切到 `/positions?tab=manual`
- **THEN** 系统在曲线下方展示所有 `strategy_id IS NULL` 的持仓,顶部带 `+ 添加持仓` 按钮

#### Scenario: Navigate to strategy detail
- **WHEN** 用户点击策略持仓 tab 中的某条记录
- **THEN** 系统跳转到对应策略详情页的持仓 Tab(行为不变)

---

### Requirement: Multi-symbol rebalancing via manual lots
用户 SHALL 能够通过手动增删 lot 记录表达换仓操作（减仓 A 买入 B）。

#### Scenario: Rebalancing between symbols
- **WHEN** 用户删除/减少 symbol A 的 lot，并为 symbol B 新增 lot
- **THEN** 系统分别更新两个 position 下的 lot 记录，正确反映换仓后的持仓状态

---

### Requirement: Display and edit reference price in positions view
用户 SHALL 能够在持仓 Tab 中查看每只股票的参考价，并通过 inline 编辑手动更新。

#### Scenario: Reference price displayed
- **WHEN** 用户查看策略详情持仓 Tab
- **THEN** 每个持仓卡片显示该 position 的 reference_price；若为 null 则显示"未设定"

#### Scenario: Inline edit reference price
- **WHEN** 用户点击参考价旁的编辑按钮，输入新值后确认
- **THEN** 系统调用 PATCH API 更新 reference_price，并刷新持仓列表展示新值

#### Scenario: Cancel inline edit
- **WHEN** 用户点击取消或按 Escape 键
- **THEN** 系统不修改 reference_price，恢复展示原值
