/**
 * Manually enqueue a pg-boss job. The worker picks it up next.
 *
 * Usage (inside db-migrate container or any node env with DATABASE_URL):
 *   npx tsx scripts/trigger-job.ts <queue-name>
 *
 * Available queues: daily-monitoring | daily-price-refresh | daily-news
 *
 * Optional second arg = JSON payload, e.g.
 *   npx tsx scripts/trigger-job.ts daily-monitoring '{"strategyId":"abc"}'
 */
import { PgBoss } from "pg-boss";

async function main() {
  const queue = process.argv[2];
  if (!queue) {
    console.error("usage: tsx scripts/trigger-job.ts <queue-name> [jsonPayload]");
    process.exit(1);
  }
  const payload = process.argv[3] ? JSON.parse(process.argv[3]) : { triggeredBy: "manual" };

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const boss = new PgBoss({ connectionString: url });
  await boss.start();
  const id = await boss.send(queue, payload);
  await boss.stop();
  console.log(`✓ enqueued ${queue} (job id: ${id ?? "<unknown>"})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
