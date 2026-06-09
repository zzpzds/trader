import { PgBoss } from "pg-boss";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@trader/db";
import { runMonitoringJob } from "./monitoring/job.js";
import { runPriceRefreshJob } from "./monitoring/price-refresh-job.js";
import { ensurePriceSnapshots } from "./monitoring/price-snapshots.js";
import { isRateLimitError } from "./monitoring/alphavantage-fetch.js";
import { runNewsJob } from "./news/job.js";
import { seedSkills } from "./lib/seed-skills.js";
export function createWorker(databaseUrl) {
    const boss = new PgBoss({ connectionString: databaseUrl });
    const sql = postgres(databaseUrl, { max: 5 });
    const db = drizzle(sql, { schema });
    boss.on("error", (err) => {
        console.error("[pg-boss] error:", err);
    });
    return {
        boss,
        async start() {
            await boss.start();
            // Idempotent skill seeding — failures must not block worker startup.
            try {
                const result = await seedSkills(db);
                console.log(`[worker] seed-skills: inserted=${result.inserted} skipped=${result.skipped} failed=${result.failed}`);
            }
            catch (err) {
                console.error("[worker] seed-skills failed:", err);
            }
            await boss.createQueue("daily-price-refresh");
            await boss.work("daily-price-refresh", async () => {
                console.log("[worker] daily-price-refresh job triggered");
                await runPriceRefreshJob(db);
            });
            await boss.schedule("daily-price-refresh", "0 1 * * *");
            console.log("[worker] daily-price-refresh cron registered (0 1 * * * UTC)");
            await boss.createQueue("manual-backfill");
            await boss.work("manual-backfill", async (jobs) => {
                const { symbol, fromDate } = jobs[0].data;
                console.log(`[worker] manual-backfill triggered: ${symbol} from ${fromDate}`);
                try {
                    await ensurePriceSnapshots(db, symbol, fromDate);
                }
                catch (err) {
                    // Daily quota won't reset within pg-boss's retry window, so retrying
                    // only burns more requests. Complete the job; the daily cron backfills.
                    if (isRateLimitError(err)) {
                        console.warn(`[worker] manual-backfill ${symbol}: rate limited, skipping retry`);
                        return;
                    }
                    throw err;
                }
            });
            await boss.createQueue("daily-monitoring");
            await boss.work("daily-monitoring", async (jobs) => {
                const strategyId = jobs[0]?.data?.strategyId;
                console.log("[worker] daily-monitoring job triggered", strategyId ? `strategyId=${strategyId}` : "(all)");
                await runMonitoringJob(db, strategyId);
            });
            await boss.schedule("daily-monitoring", "0 2 * * *");
            console.log("[worker] started, daily-monitoring cron registered (0 2 * * * UTC)");
            await boss.createQueue("daily-news");
            await boss.work("daily-news", async () => {
                console.log("[worker] daily-news job triggered");
                await runNewsJob(db);
            });
            await boss.schedule("daily-news", "30 1 * * *");
            console.log("[worker] daily-news cron registered (30 1 * * * UTC = 09:30 CST)");
        },
        async stop() {
            await boss.stop({ graceful: true, timeout: 10_000 });
            await sql.end();
            console.log("[worker] stopped");
        },
    };
}
