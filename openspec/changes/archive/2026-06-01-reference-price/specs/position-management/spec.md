## MODIFIED Requirements

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

## ADDED Requirements

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
