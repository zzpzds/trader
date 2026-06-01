## MODIFIED Requirements

### Requirement: Positions overview page
用户 SHALL 能够在持仓管理总览页查看所有策略的持仓汇总。

#### Scenario: All positions listed
- **WHEN** 用户访问持仓管理页
- **THEN** 系统按策略分组展示所有策略的所有持仓，每条显示：股票代码、总股数、加权均价、最近监控价、浮动盈亏%

#### Scenario: Navigate to strategy detail
- **WHEN** 用户点击某条持仓记录
- **THEN** 系统跳转到对应策略详情页的持仓 Tab

#### Scenario: Portfolio summary card at top
- **WHEN** 用户访问持仓管理页
- **THEN** 系统在持仓列表上方展示「总持仓收益」汇总卡片，卡片下方展示全量历史收益率折线图
