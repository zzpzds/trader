import Anthropic from "@anthropic-ai/sdk";
import type { RelevantMemory } from "./load-memories.js";
export interface AnalysisResult {
    analysis: string;
    hasActionItems: boolean;
    actionSummary?: string;
    referencePriceUpdates: Array<{
        symbol: string;
        newReferencePrice: number;
    }>;
    suggestedSkills: string[];
}
export interface SkillCatalogEntry {
    name: string;
    description: string | null;
}
export interface PositionInfo {
    symbol: string;
    totalShares: number;
    avgCost: number;
    referencePrice?: number | null;
    lots: Array<{
        shares: number;
        costPrice: number;
        lotDate: string;
        notes?: string;
    }>;
}
export interface SkillForAnalysis {
    id: string;
    name: string;
    bodyMd: string;
}
export declare function createAnalyzer(client?: Anthropic): (strategyName: string, strategyContent: string, positions: PositionInfo[], prices: Record<string, {
    latest: number;
    bars: Array<{
        date: string;
        close: number;
    }>;
}>, memories?: RelevantMemory[], skills?: SkillForAnalysis[], availableSkills?: SkillCatalogEntry[]) => Promise<AnalysisResult>;
export declare const analyzeStrategy: (strategyName: string, strategyContent: string, positions: PositionInfo[], prices: Record<string, {
    latest: number;
    bars: Array<{
        date: string;
        close: number;
    }>;
}>, memories?: RelevantMemory[], skills?: SkillForAnalysis[], availableSkills?: SkillCatalogEntry[]) => Promise<AnalysisResult>;
