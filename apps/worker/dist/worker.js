import { PgBoss } from "pg-boss";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@trader/db";
import { runMonitoringJob } from "./monitoring/job.js";
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
            await boss.createQueue("daily-monitoring");
            await boss.work("daily-monitoring", async () => {
                console.log("[worker] daily-monitoring job triggered");
                await runMonitoringJob(db);
            });
            await boss.schedule("daily-monitoring", "0 2 * * *");
            console.log("[worker] started, daily-monitoring cron registered (0 2 * * * UTC)");
        },
        async stop() {
            await boss.stop({ graceful: true, timeout: 10_000 });
            await sql.end();
            console.log("[worker] stopped");
        },
    };
}
