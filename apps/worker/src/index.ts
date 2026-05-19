import { createWorker } from "./worker.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const worker = createWorker(databaseUrl);

worker.start().catch((err) => {
  console.error("[worker] fatal startup error:", err);
  process.exit(1);
});

async function shutdown(signal: string) {
  console.log(`[worker] received ${signal}, shutting down…`);
  await worker.stop();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
