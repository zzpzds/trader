## 1. 数据库 Schema

- [x] 1.1 在 `packages/db/src/schema.ts` 的 `positions` 表中新增 `referencePrice: numeric("reference_price", { precision: 15, scale: 4 })` 可空字段
- [x] 1.2 更新 `packages/db/src/schema.test.ts`，断言 `positions` 表包含 `referencePrice` 列
- [x] 1.3 运行 `pnpm --filter @trader/db db:push` 将新列推送到数据库
- [x] 1.4 运行 `pnpm --filter @trader/db build` 重建 dist 类型

## 2. 首 lot 初始化参考价

- [x] 2.1 在 `apps/web/lib/__tests__/position-service.test.ts` 添加测试：首笔 lot 创建时 insert positions 包含 `referencePrice: costPrice`
- [x] 2.2 在 `apps/web/lib/__tests__/position-service.test.ts` 添加测试：加仓 lot 不修改 referencePrice（update 调用不包含 referencePrice）
- [x] 2.3 修改 `apps/web/lib/position-service.ts`，在新建 position 的 insert values 中加入 `referencePrice: costPrice`

## 3. Worker analyze.ts 扩展

- [x] 3.1 在 `apps/worker/src/monitoring/__tests__/analyze.test.ts` 添加测试：LLM 输出 reference_price_updates 时，AnalysisResult.referencePriceUpdates 正确映射
- [x] 3.2 在 `apps/worker/src/monitoring/__tests__/analyze.test.ts` 添加测试：LLM 不输出 reference_price_updates 时，referencePriceUpdates 为空数组
- [x] 3.3 在 `apps/worker/src/monitoring/analyze.ts` 的 `PositionInfo` 接口中加入 `referencePrice?: number | null`
- [x] 3.4 在 `apps/worker/src/monitoring/analyze.ts` 的 `AnalysisResult` 接口中加入 `referencePriceUpdates: Array<{ symbol: string; newReferencePrice: number }>`
- [x] 3.5 在 `apps/worker/src/monitoring/analyze.ts` 的 `reportToolSchema` 中新增 `reference_price_updates` 数组字段
- [x] 3.6 在 `apps/worker/src/monitoring/analyze.ts` 的 `positionSummary` 字符串中追加参考价信息（null 时显示"无参考价"）
- [x] 3.7 在 `apps/worker/src/monitoring/analyze.ts` 的 `return` 语句中解析并映射 `reference_price_updates` 到 `referencePriceUpdates`

## 4. Worker job.ts 写回

- [x] 4.1 在 `apps/worker/src/monitoring/__tests__/job.test.ts` 添加测试：analyze 返回 referencePriceUpdates 时，db.update positions 被调用且 referencePrice 值正确
- [x] 4.2 在 `apps/worker/src/monitoring/job.ts` 的 `StrategyWithLots` 接口中加入 `referencePrice: string | null`
- [x] 4.3 在 `apps/worker/src/monitoring/job.ts` 的 `findStrategiesWithLots` 中在 positions 映射里传递 `referencePrice: p.referencePrice ?? null`
- [x] 4.4 在 `apps/worker/src/monitoring/job.ts` 的 `processStrategy` 中构建 positionInfos 时加入 `referencePrice` 字段
- [x] 4.5 在 `apps/worker/src/monitoring/job.ts` 的 `processStrategy` 中，analysis 完成后遍历 `referencePriceUpdates`，对每个 symbol 执行 `db.update(positions).set({ referencePrice })`
- [x] 4.6 在 `apps/worker/src/monitoring/job.ts` 中更新通知逻辑：有 action items 时将参考价变更追加到 content；无 action items 但有 referencePriceUpdates 时单独创建"参考价更新"通知

## 5. 手动覆盖 API

- [x] 5.1 创建 `apps/web/app/api/strategies/[id]/positions/[positionId]/reference-price/__tests__/route.test.ts`，覆盖：缺少 referencePrice 返回 400、position 不存在返回 404、正常更新返回 200
- [x] 5.2 创建 `apps/web/app/api/strategies/[id]/positions/[positionId]/reference-price/route.ts`，实现 `PATCH` handler：校验 body、验证 position 归属、更新并返回

## 6. 前端 UI

- [x] 6.1 在 `apps/web/app/strategies/[id]/page.tsx` 的 `Position` interface 中加入 `referencePrice: string | null`
- [x] 6.2 在 `apps/web/app/strategies/[id]/page.tsx` 中加入 inline 编辑状态：`editingRefPriceId` 和 `refPriceInput`
- [x] 6.3 在 `apps/web/app/strategies/[id]/page.tsx` 中实现 `handleSaveRefPrice` 函数，调用 PATCH API 并刷新持仓
- [x] 6.4 在 `apps/web/app/strategies/[id]/page.tsx` 的持仓卡片 header 中展示参考价（null 时显示"未设定"），并附编辑按钮和 inline 编辑 UI
