import type { drizzle } from "drizzle-orm/postgres-js";
import type * as schema from "@trader/db";
type DbType = ReturnType<typeof drizzle<typeof schema>>;
export interface RawMemory {
    id: string;
    title: string;
    content: string;
    kind: "note" | "idea" | "lesson" | "context";
    symbol: string | null;
    pinned: boolean;
    updatedAt: Date;
}
export interface RelevantMemory {
    id: string;
    title: string;
    kind: string;
    symbol: string | null;
    pinned: boolean;
    contentPreview: string;
}
export declare function mergeAndCapMemories(pinnedRows: RawMemory[], strategyRows: RawMemory[], symbolRows: RawMemory[]): RelevantMemory[];
export declare function loadRelevantMemories(db: DbType, strategyId: string, symbols: string[]): Promise<RelevantMemory[]>;
export {};
