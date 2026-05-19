"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.strategySchema = void 0;
exports.parseIndicatorRef = parseIndicatorRef;
const zod_1 = require("zod");
function parseIndicatorRef(ref) {
    const dotIdx = ref.indexOf(".");
    if (dotIdx === -1) {
        return { indicatorId: ref, subField: undefined };
    }
    return {
        indicatorId: ref.slice(0, dotIdx),
        subField: ref.slice(dotIdx + 1),
    };
}
const INDICATOR_TYPES = ["SMA", "EMA", "MACD", "RSI", "BBANDS", "VOLUME_MA"];
const TIMEFRAMES = ["1d", "1h", "15m"];
const EXECUTION_PRICES = ["next_open", "current_close"];
const indicatorSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    type: zod_1.z.enum(INDICATOR_TYPES),
    params: zod_1.z.record(zod_1.z.string(), zod_1.z.number()),
});
const crossConditionSchema = zod_1.z.object({
    type: zod_1.z.enum(["crossover", "crossunder"]),
    left: zod_1.z.string().min(1),
    right: zod_1.z.union([zod_1.z.string().min(1), zod_1.z.number()]),
});
const compareConditionSchema = zod_1.z.object({
    type: zod_1.z.enum(["above", "below", "pct_above"]),
    left: zod_1.z.string().min(1),
    right: zod_1.z.union([zod_1.z.string().min(1), zod_1.z.number()]),
});
const positionChangeConditionSchema = zod_1.z.object({
    type: zod_1.z.enum(["position_down", "position_up"]),
    pct: zod_1.z.number().positive(),
});
const entryConditionSchema = zod_1.z.discriminatedUnion("type", [
    crossConditionSchema,
    compareConditionSchema,
    positionChangeConditionSchema,
]);
const exitConditionSchema = zod_1.z.discriminatedUnion("type", [
    crossConditionSchema,
    compareConditionSchema,
    zod_1.z.object({ type: zod_1.z.literal("stop_loss"), pct: zod_1.z.number().positive() }),
    zod_1.z.object({ type: zod_1.z.literal("take_profit"), pct: zod_1.z.number().positive() }),
    zod_1.z.object({ type: zod_1.z.literal("trailing_stop"), pct: zod_1.z.number().positive() }),
    positionChangeConditionSchema,
]);
const positionSizingSchema = zod_1.z.object({
    type: zod_1.z.literal("fixed_pct"),
    pct: zod_1.z.number().positive().max(100),
});
const baseStrategySchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    symbol: zod_1.z.string().min(1),
    timeframe: zod_1.z.enum(TIMEFRAMES),
    indicators: zod_1.z.array(indicatorSchema),
    entryConditions: zod_1.z.array(entryConditionSchema).min(1),
    exitConditions: zod_1.z.array(exitConditionSchema).min(1),
    positionSizing: positionSizingSchema,
    maxAdditions: zod_1.z.number().int().min(0),
    executionPrice: zod_1.z.enum(EXECUTION_PRICES),
});
function extractIndicatorRefs(conditions) {
    const refs = [];
    for (const cond of conditions) {
        if ("left" in cond) {
            refs.push(String(cond.left));
            if (typeof cond.right === "string")
                refs.push(cond.right);
        }
    }
    return refs;
}
function validateIndicatorRefs(indicatorIds, conditions, ctx) {
    for (const cond of conditions) {
        const refsToCheck = [];
        if ("left" in cond && typeof cond.left === "string") {
            refsToCheck.push(cond.left);
        }
        if ("right" in cond && typeof cond.right === "string") {
            refsToCheck.push(cond.right);
        }
        for (const ref of refsToCheck) {
            const { indicatorId } = parseIndicatorRef(ref);
            if (!indicatorIds.has(indicatorId)) {
                ctx.addIssue({
                    code: zod_1.z.ZodIssueCode.custom,
                    message: `Undefined indicator reference: "${indicatorId}"`,
                });
            }
        }
    }
}
exports.strategySchema = baseStrategySchema.superRefine((data, ctx) => {
    const indicatorIds = new Set(data.indicators.map((i) => i.id));
    validateIndicatorRefs(indicatorIds, data.entryConditions, ctx);
    validateIndicatorRefs(indicatorIds, data.exitConditions, ctx);
});
