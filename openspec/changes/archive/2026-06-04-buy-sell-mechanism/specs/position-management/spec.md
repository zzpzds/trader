## ADDED Requirements

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

## MODIFIED Requirements

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
