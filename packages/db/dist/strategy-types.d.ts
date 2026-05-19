export type Timeframe = "1d" | "1h" | "15m";
export type IndicatorType = "SMA" | "EMA" | "MACD" | "RSI" | "BBANDS" | "VOLUME_MA";
export type ExecutionPrice = "next_open" | "current_close";
export interface Indicator {
    id: string;
    type: IndicatorType;
    params: Record<string, number>;
}
export type ConditionType = "crossover" | "crossunder" | "above" | "below" | "pct_above" | "stop_loss" | "take_profit" | "trailing_stop" | "position_down" | "position_up";
export interface CrossCondition {
    type: "crossover" | "crossunder";
    left: string;
    right: string | number;
}
export interface CompareCondition {
    type: "above" | "below" | "pct_above";
    left: string;
    right: string | number;
}
export interface StopLossCondition {
    type: "stop_loss";
    pct: number;
}
export interface TakeProfitCondition {
    type: "take_profit";
    pct: number;
}
export interface TrailingStopCondition {
    type: "trailing_stop";
    pct: number;
}
export interface PositionChangeCondition {
    type: "position_down" | "position_up";
    pct: number;
}
export type EntryCondition = CrossCondition | CompareCondition | PositionChangeCondition;
export type ExitCondition = CrossCondition | CompareCondition | StopLossCondition | TakeProfitCondition | TrailingStopCondition | PositionChangeCondition;
export interface PositionSizing {
    type: "fixed_pct";
    pct: number;
}
export interface Strategy {
    name: string;
    symbol: string;
    timeframe: Timeframe;
    indicators: Indicator[];
    entryConditions: EntryCondition[];
    exitConditions: ExitCondition[];
    positionSizing: PositionSizing;
    maxAdditions: number;
    executionPrice: ExecutionPrice;
}
