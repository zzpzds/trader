import { PgBoss } from "pg-boss";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@trader/db";
import { runMonitoringJob } from "./monitoring/job.js";

export function createWorker(databaseUrl: string) {
  const boss = new PgBoss({ connectionString: databaseUrl });

  const sql = postgres(databaseUrl, { max: 5 });
  const db = drizzle(sql, { schema });

  boss.on("error", (err: Error) => {
    console.error("[pg-boss] error:", err);
  });

  return {
    boss,
    async start() {
      await boss.start();

      await boss.createQueue("daily-monitoring");
      await boss.work("daily-monitoring", async (job) => {
        const strategyId = (job.data as { strategyId?: string })?.strategyId;
        console.log("[worker] daily-monitoring job triggered", strategyId ? `strategyId=${strategyId}` : "(all)");
        await runMonitoringJob(db, strategyId);
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
