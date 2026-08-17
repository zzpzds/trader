## ADDED Requirements

### Requirement: Canonical strategy symbols drive hotspot queries

热点任务 SHALL 以策略保存后的 `strategies.symbols` 作为机器可读的规范标的范围；目标策略完成标的替换时，保存操作和上线检查 MUST 确认标的列表与策略正文/脚本描述一致。

#### Scenario: Replaced symbol is used by hotspot search

- **WHEN** 目标 AI 策略已将 AIQ 替换为 AMKR 并保存 `symbols = [NVDA, GOOGL, MSFT, META, AMKR]`
- **THEN** 下一次热点任务 SHALL 生成 AMKR 查询且不得生成 AIQ 查询

#### Scenario: Production correction is verified after update

- **WHEN** 运维通过现有策略 API 修正目标策略配置
- **THEN** 系统 MUST 在写入后重新读取该策略并确认 `symbols`、正文和脚本均引用 AMKR 而非 AIQ
