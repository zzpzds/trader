import { eq, and, asc, gte, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { strategies, positions, monitoringRuns, notifications, priceSnapshots, skills, strategySkills, } from "@trader/db";
import { fetchPrices } from "./alphavantage-fetch.js";
import { createAnalyzer } from "./analyze.js";
import { loadRelevantMemories } from "./load-memories.js";
import pLimit from "p-limit";
const CONCURRENCY_LIMIT = 3;
const ANALYZE_MAX_ATTEMPTS = 3;
const ANALYZE_RETRY_BASE_MS = 10_000;
const DEFAULT_ANALYSIS_WINDOW_DAYS = 60;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function withRetry(fn, maxAttempts, baseDelayMs, label) {
    let lastErr = new Error("unknown");
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastErr = err instanceof Error ? err : new Error(String(err));
            if (attempt < maxAttempts) {
                const delay = baseDelayMs * attempt;
                console.warn(`[monitoring] ${label} attempt ${attempt}/${maxAttempts} failed: ${lastErr.message}, retrying in ${delay / 1000}s`);
                await sleep(delay);
            }
        }
    }
    throw lastErr;
}
export async function runMonitoringJob(db, strategyId) {
    const limit = pLimit(CONCURRENCY_LIMIT);
    const analyze = createAnalyzer();
    const strategiesWithLots = await findStrategiesWithLots(db, strategyId);
    if (strategiesWithLots.length === 0) {
        console.log("[monitoring] No strategies with lots found, skipping");
        return;
    }
    const tasks = strategiesWithLots.map((strategy) => limit(() => processStrategy(db, strategy, analyze)));
    await Promise.allSettled(tasks);
}
async function findStrategiesWithLots(db, strategyId) {
    const allStrategies = strategyId
        ? await db.query.strategies.findMany({ where: eq(strategies.id, strategyId) })
        : await db.query.strategies.findMany();
    const result = [];
    for (const strategy of allStrategies) {
        const pos = await db.query.positions.findMany({
            where: eq(positions.strategyId, strategy.id),
            with: { positionLots: true },
        });
        const posWithLots = pos.filter((p) => p.positionLots.length > 0);
        if (posWithLots.length > 0) {
            result.push({
                id: strategy.id,
                name: strategy.name,
                content: strategy.content,
                symbols: strategy.symbols ?? [],
                analysisWindowDays: strategy.analysisWindowDays ?? DEFAULT_ANALYSIS_WINDOW_DAYS,
                positions: posWithLots.map((p) => ({
                    id: p.id,
                    symbol: p.symbol,
                    referencePrice: p.referencePrice ?? null,
                    positionLots: p.positionLots.map((l) => ({
                        shares: l.shares,
                        costPrice: l.costPrice,
                        lotDate: l.lotDate,
                        notes: l.notes,
                    })),
                })),
            });
        }
    }
    return result;
}
async function readSnapshotsForStrategy(db, symbols, windowDays) {
    const since = new Date(Date.now() - windowDays * 86_400_000)
        .toISOString()
        .slice(0, 10);
    const rows = await db
        .select({
        symbol: priceSnapshots.symbol,
        date: priceSnapshots.date,
        open: priceSnapshots.open,
        high: priceSnapshots.high,
        low: priceSnapshots.low,
        close: priceSnapshots.close,
        volume: priceSnapshots.volume,
    })
        .from(priceSnapshots)
        .where(and(inArray(priceSnapshots.symbol, symbols), gte(priceSnapshots.date, since)))
        .orderBy(asc(priceSnapshots.date));
    const grouped = {};
    for (const r of rows) {
        if (!grouped[r.symbol])
            grouped[r.symbol] = { latest: 0, bars: [] };
        grouped[r.symbol].bars.push({
            date: r.date,
            open: parseFloat(r.open),
            high: parseFloat(r.high),
            low: parseFloat(r.low),
            close: parseFloat(r.close),
            volume: r.volume != null ? Number(r.volume) : 0,
        });
    }
    for (const sym of Object.keys(grouped)) {
        const bars = grouped[sym].bars;
        grouped[sym].latest = bars.length > 0 ? bars[bars.length - 1].close : 0;
    }
    return grouped;
}
async function loadSkillsForStrategy(db, strategyId) {
    const rows = await db
        .select({ id: skills.id, name: skills.name, bodyMd: skills.bodyMd })
        .from(strategySkills)
        .innerJoin(skills, eq(strategySkills.skillId, skills.id))
        .where(eq(strategySkills.strategyId, strategyId));
    return rows;
}
export async function processStrategy(db, strategy, analyze) {
    const today = new Date().toISOString().slice(0, 10);
    const [run] = await db
        .insert(monitoringRuns)
        .values({
        strategyId: strategy.id,
        runDate: today,
        status: "pending",
    })
        .returning();
    try {
        const symbols = strategy.positions.map((p) => p.symbol);
        let prices = await readSnapshotsForStrategy(db, symbols, strategy.analysisWindowDays);
        // Transitional fallback: if price_snapshots has no data for any symbol
        // of this strategy, fetch inline. Removed in a later cleanup once
        // daily-price-refresh has been live for 1-2 weeks.
        const haveAnyData = Object.keys(prices).length > 0;
        if (!haveAnyData) {
            console.warn(`[monitoring] Strategy ${strategy.name}: price_snapshots empty for ${symbols.join(", ")}, falling back to inline fetchPrices`);
            try {
                prices = await fetchPrices(symbols, `${strategy.analysisWindowDays}d`);
            }
            catch (err) {
                console.error(`[monitoring] Strategy ${strategy.name}: inline fetchPrices fallback failed:`, err instanceof Error ? err.message : String(err));
            }
        }
        const missing = symbols.filter((s) => !prices[s] || prices[s].bars.length === 0);
        if (missing.length === symbols.length) {
            throw new Error(`No price data for any symbol: ${missing.join(", ")}`);
        }
        if (missing.length > 0) {
            console.warn(`[monitoring] Strategy ${strategy.name}: missing snapshots for ${missing.join(", ")}`);
        }
        const positionInfos = strategy.positions.map((p) => {
            const totalShares = p.positionLots.reduce((s, l) => s + parseFloat(l.shares), 0);
            const totalCost = p.positionLots.reduce((s, l) => s + parseFloat(l.shares) * parseFloat(l.costPrice), 0);
            const avgCost = totalShares > 0 ? totalCost / totalShares : 0;
            return {
                symbol: p.symbol,
                totalShares,
                avgCost,
                referencePrice: p.referencePrice !== null ? parseFloat(p.referencePrice) : null,
                lots: p.positionLots.map((l) => ({
                    shares: parseFloat(l.shares),
                    costPrice: parseFloat(l.costPrice),
                    lotDate: l.lotDate,
                    notes: l.notes ?? undefined,
                })),
            };
        });
        const loadedSkills = await loadSkillsForStrategy(db, strategy.id);
        const analysis = await withRetry(async () => {
            const symbols = strategy.positions.map((p) => p.symbol);
            const relevantMemories = await loadRelevantMemories(db, strategy.id, symbols);
            return analyze(strategy.name, strategy.content, positionInfos, prices, relevantMemories, loadedSkills);
        }, ANALYZE_MAX_ATTEMPTS, ANALYZE_RETRY_BASE_MS, `analyze(${strategy.name})`);
        const skillSnapshot = loadedSkills.map((s) => ({
            id: s.id,
            name: s.name,
            body_md_hash: createHash("sha256").update(s.bodyMd).digest("hex"),
            body_md_preview: s.bodyMd.slice(0, 500),
        }));
        await db
            .update(monitoringRuns)
            .set({
            status: "completed",
            analysis: analysis.analysis,
            hasActionItems: analysis.hasActionItems,
            skillSnapshot,
        })
            .where(eq(monitoringRuns.id, run.id));
        const refPriceUpdates = analysis.referencePriceUpdates;
        for (const update of refPriceUpdates) {
            await db
                .update(positions)
                .set({ referencePrice: update.newReferencePrice.toFixed(4) })
                .where(and(eq(positions.strategyId, strategy.id), eq(positions.symbol, update.symbol)));
            console.log(`[monitoring] Strategy ${strategy.name}: ${update.symbol} referencePrice updated to ${update.newReferencePrice}`);
        }
        const refPriceNote = refPriceUpdates.length > 0
            ? "\n\n**参考价变更：**\n" + refPriceUpdates.map((u) => `- ${u.symbol} 参考价已更新为 $${u.newReferencePrice.toFixed(2)}`).join("\n")
            : "";
        if (analysis.hasActionItems) {
            await db.insert(notifications).values({
                monitoringRunId: run.id,
                title: analysis.actionSummary ?? "Action required",
                content: (analysis.analysis.slice(0, 400) + refPriceNote).slice(0, 500),
                isRead: false,
            });
        }
        else if (refPriceUpdates.length > 0) {
            await db.insert(notifications).values({
                monitoringRunId: run.id,
                title: "参考价更新",
                content: refPriceNote.trim().slice(0, 500),
                isRead: false,
            });
        }
        console.log(`[monitoring] Strategy ${strategy.name}: completed, actionItems=${analysis.hasActionItems}, refPriceUpdates=${refPriceUpdates.length}`);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db
            .update(monitoringRuns)
            .set({ status: "failed", error: message })
            .where(eq(monitoringRuns.id, run.id));
        console.error(`[monitoring] Strategy ${strategy.name}: failed - ${message}`);
    }
}
