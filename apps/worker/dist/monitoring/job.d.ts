import { createAnalyzer } from "./analyze.js";
import type { drizzle } from "drizzle-orm/postgres-js";
import type * as schema from "@trader/db";
type DbType = ReturnType<typeof drizzle<typeof schema>>;
export declare function runMonitoringJob(db: DbType, strategyId?: string): Promise<void>;
interface StrategyWithLots {
    id: string;
    name: string;
    content: string;
    symbols: string[];
    analysisWindowDays: number;
    positions: Array<{
        id: string;
        symbol: string;
        referencePrice: string | null;
        positionLots: Array<{
            shares: string;
            costPrice: string;
            lotDate: string;
            notes: string | null;
        }>;
    }>;
}
export declare function processStrategy(db: DbType, strategy: StrategyWithLots, analyze: ReturnType<typeof createAnalyzer>): Promise<void>;
export {};
