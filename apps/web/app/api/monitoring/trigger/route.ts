import { PgBoss } from "pg-boss";

export async function POST() {
  try {
    const boss = new PgBoss({ connectionString: process.env.DATABASE_URL! });
    await boss.start();

    await boss.send("daily-monitoring", { triggeredBy: "manual" });

    await boss.stop();
    return Response.json({ ok: true, message: "Monitoring triggered for all strategies" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
