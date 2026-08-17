# Subagent Progress

- Change: `fix-strategy-data-integrity`
- Worktree: `/Users/didi/code/trader/.worktrees/fix-strategy-data-integrity`
- Branch: `feature/20260817/fix-strategy-data-integrity`
- Build mode: `subagent-driven-development`
- TDD mode: `tdd`
- Review mode: `standard`
- Baseline: DB 44/44、Web 240/240 通过；Worker 既有 Alpha Vantage 测试因固定 2026-05 日期超出当前 60 天窗口而 5 项失败，用户已明确选择继续，本 change 不修改该测试域。
- Plan preflight: 无阻塞性架构矛盾；Task 5/6/7 不新增生产代码，分别按 characterization、文档/外部操作、验证任务记录 TDD 不适用。

## Completed Tasks

- Task: `Task 1: 建立共享持仓回放模块`
- OpenSpec mapping: `1.1 在 @trader/db 中提取并导出纯函数式交易回放类型与实现，保持现有移动平均成本语义`；`1.3 为共享回放补充部分卖出、全部卖出、重新建仓和示例交易序列测试`
- Stage: `checkoff`
- Implementation commits: `858fd43a2e2bd4af0ca3ecf5df1ffc8b4189484f`、`35d754e`
- Changed files: `packages/db/src/position-replay.ts`、`packages/db/src/position-replay.test.ts`、`packages/db/package.json`
- RED evidence: `npm run test -w @trader/db -- src/position-replay.test.ts` 因 `./position-replay` 不存在而失败
- GREEN evidence: 修复后指定测试 11/11、DB 全量 55/55、`npm run build -w @trader/db` 通过
- Risk signals: 新增公共 package 子路径；总 diff 188 行
- Task review required: yes（standard / public API）
- Review/fix round: 1/1
- Applied review fixes: 公共函数改为 `replayPosition`；`date` 收窄为 `string`；`createdAt` 按时间戳排序并新增跨时区回归测试；锁定重建仓 `grossInvested: 6000`；新增显式 `null` type 测试
- Re-review: 源码、测试和 package 子路径满足 API 与行为契约；复审仅要求由主流程完成计划/OpenSpec 勾选
- Unresolved feedback: 无

## Completed Tasks

- Task: `Task 2: 将 Web P&L 改为共享实现的兼容层`
- OpenSpec mapping: `1.2 将 Web 的 P&L 模块切换为共享实现，并保持原有公共接口兼容`
- Stage: `checkoff`
- Allowed files: `apps/web/lib/pnl.ts`、`apps/web/lib/__tests__/pnl.test.ts`、`apps/web/vitest.config.ts`
- TDD requirement: 先证明本地 `replayPosition` 与共享导出不相同，再以共享导出替换并保持 Web 专用接口兼容
- Implementation commit: `09df189`
- Changed files: `apps/web/lib/pnl.ts`、`apps/web/lib/__tests__/pnl.test.ts`、`apps/web/vitest.config.ts`
- RED evidence: DB 构建通过；Web P&L 13 项中仅新增的导出身份断言失败
- GREEN evidence: DB 构建通过；Web P&L 13/13；Web production build 通过（首次沙箱内 Google Fonts DNS 失败，联网重试后通过）
- Risk signals: 跨 package 公共兼容层
- Task review required: yes（standard / public compatibility）
- Review/fix round: 0/1
- Plan reconciliation: RED 首先暴露 Vitest 根入口 alias 吞掉 package 子路径；计划已纳入将 alias 收窄为仅匹配 `@trader/db` 根入口的最小测试基础设施修正
- Task review: APPROVED—共享函数身份、Web 类型/辅助函数兼容、根入口精确 alias 与变更范围均符合计划
- Unresolved feedback: 无

## Current Task

- Task: `Task 3: 修复 Worker 的 BUY/SELL 聚合输入`
- OpenSpec mapping: `2.1 扩展监控持仓查询与分析输入，保留 type、createdAt 和交易顺序信息`；`2.2 使用共享回放结果替换 Worker 对所有 lot 的直接正向求和`；`2.3 增加 Worker 回归测试，验证卖出不会增加持股或成本且 Web/Worker 结果一致`
- Stage: `checkoff`
- Allowed files: `apps/worker/src/monitoring/job.ts`、`apps/worker/src/monitoring/analyze.ts`、`apps/worker/src/monitoring/__tests__/job.test.ts`、`apps/worker/vitest.config.ts`
- TDD requirement: 先以 BUY→SELL→BUY 序列证明现有 Worker 错算 15 股，再映射完整 lot 并调用共享回放
- Implementation commit: `97c86a1`
- Changed files: `apps/worker/src/monitoring/job.ts`、`apps/worker/src/monitoring/analyze.ts`、`apps/worker/src/monitoring/__tests__/job.test.ts`、`apps/worker/vitest.config.ts`
- RED evidence: 新回归用例显示旧 Worker 把三笔 lot 正向求和为 15 股，且缺少成本/已实现盈亏/清仓字段
- GREEN evidence: DB 构建通过；Worker job 定向测试通过；Worker build 仅因 Task 4 计划内的 `analyze.test.ts` fixture 尚未补齐新必填字段而失败
- Risk signals: Worker 监控输入契约跨模块变更；公共 package 子路径导入
- Task review required: yes（standard / multi-file behavior contract）
- Review/fix round: 1/1
- Plan reconciliation: Worker Vitest 同样需把 `@trader/db` alias 收窄为根入口精确匹配，子路径由 package exports 解析
- Review result: CHANGES_REQUESTED—新增首个用例的 `mockAnalyze.mockReset()` 清除共享默认实现，后续旧测试可能静默进入失败分支仍通过
- Review fix commit: `63f1f0b`
- Review-fix RED: 为 snapshot 覆盖用例新增 `status: completed` 断言后，泄漏状态下无法找到完成态调用
- Review-fix GREEN: 移除有害 `mockReset()` 后，Worker job 定向测试 10/10 通过，完成态断言生效
- Re-review: APPROVED—mock 默认实现得到保留，完成态断言可阻止内部失败静默通过；Task 3 无剩余 CRITICAL/IMPORTANT 问题
- Unresolved feedback: 无
