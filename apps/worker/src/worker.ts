import { PgBoss } from "pg-boss";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@trader/db";
import { runMonitoringJob } from "./monitoring/job.js";
import { runNewsJob } from "./news/job.js";

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
      await boss.work<{ strategyId?: string }>("daily-monitoring", async (jobs) => {
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
