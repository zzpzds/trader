import { PgBoss } from "pg-boss";

let bossPromise: Promise<PgBoss> | null = null;

export function getBoss(): Promise<PgBoss> {
  if (bossPromise) return bossPromise;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  bossPromise = (async () => {
    const b = new PgBoss({ connectionString: url });
    b.on("error", (err) => {
      console.error("[web pg-boss]", err);
    });
    await b.start();
    return b;
  })();
  return bossPromise;
}
