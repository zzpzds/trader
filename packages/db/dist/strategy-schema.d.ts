import { z } from "zod";
export declare function parseIndicatorRef(ref: string): {
    indicatorId: string;
    subField: string | undefined;
};
export declare const strategySchema: z.ZodEffects<z.ZodObject<{
    name: z.ZodString;
    symbol: z.ZodString;
    timeframe: z.ZodEnum<["1d", "1h", "15m"]>;
    indicators: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodEnum<["SMA", "EMA", "MACD", "RSI", "BBANDS", "VOLUME_MA"]>;
        params: z.ZodRecord<z.ZodString, z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        type: "SMA" | "EMA" | "MACD" | "RSI" | "BBANDS" | "VOLUME_MA";
        params: Record<string, number>;
    }, {
        id: string;
        type: "SMA" | "EMA" | "MACD" | "RSI" | "BBANDS" | "VOLUME_MA";
        params: Record<string, number>;
    }>, "many">;
    entryConditions: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodEnum<["crossover", "crossunder"]>;
        left: z.ZodString;
        right: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
    }, "strip", z.ZodTypeAny, {
        type: "crossover" | "crossunder";
        left: string;
        right: string | number;
    }, {
        type: "crossover" | "crossunder";
        left: string;
        right: string | number;
    }>, z.ZodObject<{
        type: z.ZodEnum<["above", "below", "pct_above"]>;
        left: z.ZodString;
        right: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
    }, "strip", z.ZodTypeAny, {
        type: "above" | "below" | "pct_above";
        left: string;
        right: string | number;
    }, {
        type: "above" | "below" | "pct_above";
        left: string;
        right: string | number;
    }>, z.ZodObject<{
        type: z.ZodEnum<["position_down", "position_up"]>;
        pct: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "position_down" | "position_up";
        pct: number;
    }, {
        type: "position_down" | "position_up";
        pct: number;
    }>]>, "many">;
    exitConditions: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodEnum<["crossover", "crossunder"]>;
        left: z.ZodString;
        right: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
    }, "strip", z.ZodTypeAny, {
        type: "crossover" | "crossunder";
        left: string;
        right: string | number;
    }, {
        type: "crossover" | "crossunder";
        left: string;
        right: string | number;
    }>, z.ZodObject<{
        type: z.ZodEnum<["above", "below", "pct_above"]>;
        left: z.ZodString;
        right: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
    }, "strip", z.ZodTypeAny, {
        type: "above" | "below" | "pct_above";
        left: string;
        right: string | number;
    }, {
        type: "above" | "below" | "pct_above";
        left: string;
        right: string | number;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"stop_loss">;
        pct: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "stop_loss";
        pct: number;
    }, {
        type: "stop_loss";
        pct: number;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"take_profit">;
        pct: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "take_profit";
        pct: number;
    }, {
        type: "take_profit";
        pct: number;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"trailing_stop">;
        pct: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "trailing_stop";
        pct: number;
    }, {
        type: "trailing_stop";
        pct: number;
    }>, z.ZodObject<{
        type: z.ZodEnum<["position_down", "position_up"]>;
        pct: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "position_down" | "position_up";
        pct: number;
    }, {
        type: "position_down" | "position_up";
        pct: number;
    }>]>, "many">;
    positionSizing: z.ZodObject<{
        type: z.ZodLiteral<"fixed_pct">;
        pct: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "fixed_pct";
        pct: number;
    }, {
        type: "fixed_pct";
        pct: number;
    }>;
    maxAdditions: z.ZodNumber;
    executionPrice: z.ZodEnum<["next_open", "current_close"]>;
}, "strip", z.ZodTypeAny, {
    symbol: string;
    name: string;
    timeframe: "1d" | "1h" | "15m";
    indicators: {
        id: string;
        type: "SMA" | "EMA" | "MACD" | "RSI" | "BBANDS" | "VOLUME_MA";
        params: Record<string, number>;
    }[];
    entryConditions: ({
        type: "crossover" | "crossunder";
        left: string;
        right: string | number;
    } | {
        type: "above" | "below" | "pct_above";
        left: string;
        right: string | number;
    } | {
        type: "position_down" | "position_up";
        pct: number;
    })[];
    exitConditions: ({
        type: "crossover" | "crossunder";
        left: string;
        right: string | number;
    } | {
        type: "above" | "below" | "pct_above";
        left: string;
        right: string | number;
    } | {
        type: "position_down" | "position_up";
        pct: number;
    } | {
        type: "stop_loss";
        pct: number;
    } | {
        type: "take_profit";
        pct: number;
    } | {
        type: "trailing_stop";
        pct: number;
    })[];
    positionSizing: {
        type: "fixed_pct";
        pct: number;
    };
    maxAdditions: number;
    executionPrice: "next_open" | "current_close";
}, {
    symbol: string;
    name: string;
    timeframe: "1d" | "1h" | "15m";
    indicators: {
        id: string;
        type: "SMA" | "EMA" | "MACD" | "RSI" | "BBANDS" | "VOLUME_MA";
        params: Record<string, number>;
    }[];
    entryConditions: ({
        type: "crossover" | "crossunder";
        left: string;
        right: string | number;
    } | {
        type: "above" | "below" | "pct_above";
        left: string;
        right: string | number;
    } | {
        type: "position_down" | "position_up";
        pct: number;
    })[];
    exitConditions: ({
        type: "crossover" | "crossunder";
        left: string;
        right: string | number;
    } | {
        type: "above" | "below" | "pct_above";
        left: string;
        right: string | number;
    } | {
        type: "position_down" | "position_up";
        pct: number;
    } | {
        type: "stop_loss";
        pct: number;
    } | {
        type: "take_profit";
        pct: number;
    } | {
        type: "trailing_stop";
        pct: number;
    })[];
    positionSizing: {
        type: "fixed_pct";
        pct: number;
    };
    maxAdditions: number;
    executionPrice: "next_open" | "current_close";
}>, {
    symbol: string;
    name: string;
    timeframe: "1d" | "1h" | "15m";
    indicators: {
        id: string;
        type: "SMA" | "EMA" | "MACD" | "RSI" | "BBANDS" | "VOLUME_MA";
        params: Record<string, number>;
    }[];
    entryConditions: ({
        type: "crossover" | "crossunder";
        left: string;
        right: string | number;
    } | {
        type: "above" | "below" | "pct_above";
        left: string;
        right: string | number;
    } | {
        type: "position_down" | "position_up";
        pct: number;
    })[];
    exitConditions: ({
        type: "crossover" | "crossunder";
        left: string;
        right: string | number;
    } | {
        type: "above" | "below" | "pct_above";
        left: string;
        right: string | number;
    } | {
        type: "position_down" | "position_up";
        pct: number;
    } | {
        type: "stop_loss";
        pct: number;
    } | {
        type: "take_profit";
        pct: number;
    } | {
        type: "trailing_stop";
        pct: number;
    })[];
    positionSizing: {
        type: "fixed_pct";
        pct: number;
    };
    maxAdditions: number;
    executionPrice: "next_open" | "current_close";
}, {
    symbol: string;
    name: string;
    timeframe: "1d" | "1h" | "15m";
    indicators: {
        id: string;
        type: "SMA" | "EMA" | "MACD" | "RSI" | "BBANDS" | "VOLUME_MA";
        params: Record<string, number>;
    }[];
    entryConditions: ({
        type: "crossover" | "crossunder";
        left: string;
        right: string | number;
    } | {
        type: "above" | "below" | "pct_above";
        left: string;
        right: string | number;
    } | {
        type: "position_down" | "position_up";
        pct: number;
    })[];
    exitConditions: ({
        type: "crossover" | "crossunder";
        left: string;
        right: string | number;
    } | {
        type: "above" | "below" | "pct_above";
        left: string;
        right: string | number;
    } | {
        type: "position_down" | "position_up";
        pct: number;
    } | {
        type: "stop_loss";
        pct: number;
    } | {
        type: "take_profit";
        pct: number;
    } | {
        type: "trailing_stop";
        pct: number;
    })[];
    positionSizing: {
        type: "fixed_pct";
        pct: number;
    };
    maxAdditions: number;
    executionPrice: "next_open" | "current_close";
}>;
export type StrategyInput = z.infer<typeof strategySchema>;
