import Anthropic from "@anthropic-ai/sdk";
export interface AnalysisResult {
    analysis: string;
    hasActionItems: boolean;
    actionSummary?: string;
}
export interface PositionInfo {
    symbol: string;
    totalShares: number;
    avgCost: number;
    lots: Array<{
        shares: number;
        costPrice: number;
        lotDate: string;
        notes?: string;
    }>;
}
export declare function createAnalyzer(client?: Anthropic): (strategyName: string, strategyContent: string, positions: PositionInfo[], prices: Record<string, {
    latest: number;
    bars: Array<{
        date: string;
        close: number;
    }>;
}>) => Promise<AnalysisResult>;
export declare const analyzeStrategy: (strategyName: string, strategyContent: string, positions: PositionInfo[], prices: Record<string, {
    latest: number;
    bars: Array<{
        date: string;
        close: number;
    }>;
}>) => Promise<AnalysisResult>;
