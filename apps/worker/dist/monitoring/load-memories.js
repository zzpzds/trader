import { sql, and, eq, or, gte, inArray, desc } from "drizzle-orm";
import { memories } from "@trader/db";
const MAX_TOTAL = 8;
const MAX_PER_CONTENT = 200;
const MAX_TOTAL_CHARS = 4000;
const RECENT_DAYS = 30;
const TOP_N_PER_BUCKET = 5;
export function mergeAndCapMemories(pinnedRows, strategyRows, symbolRows) {
    const seen = new Map();
    for (const m of [...pinnedRows, ...strategyRows, ...symbolRows]) {
        if (!seen.has(m.id))
            seen.set(m.id, m);
    }
    const list = Array.from(seen.values()).sort((a, b) => {
        if (a.pinned !== b.pinned)
            return a.pinned ? -1 : 1;
        return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
    const out = [];
    let totalChars = 0;
    for (const m of list) {
        if (out.length >= MAX_TOTAL)
            break;
        const preview = m.content.length > MAX_PER_CONTENT ? m.content.slice(0, MAX_PER_CONTENT) : m.content;
        if (totalChars + preview.length > MAX_TOTAL_CHARS)
            break;
        out.push({
            id: m.id,
            title: m.title,
            kind: m.kind,
            symbol: m.symbol,
            pinned: m.pinned,
            contentPreview: preview,
        });
        totalChars += preview.length;
    }
    return out;
}
export async function loadRelevantMemories(db, strategyId, symbols) {
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
    try {
        const pinnedRows = await db
            .select()
            .from(memories)
            .where(and(eq(memories.pinned, true), or(eq(memories.strategyId, strategyId), sql `strategy_id IS NULL`)))
            .orderBy(desc(memories.updatedAt));
        const strategyRows = await db
            .select()
            .from(memories)
            .where(and(eq(memories.strategyId, strategyId), gte(memories.updatedAt, since)))
            .orderBy(desc(memories.updatedAt))
            .limit(TOP_N_PER_BUCKET);
        let symbolRows = [];
        if (symbols.length > 0) {
            symbolRows = await db
                .select()
                .from(memories)
                .where(and(inArray(memories.symbol, symbols), gte(memories.updatedAt, since)))
                .orderBy(desc(memories.updatedAt))
                .limit(TOP_N_PER_BUCKET);
        }
        return mergeAndCapMemories(pinnedRows, strategyRows, symbolRows);
    }
    catch (err) {
        console.warn("[monitoring] loadRelevantMemories failed, returning empty:", err);
        return [];
    }
}
