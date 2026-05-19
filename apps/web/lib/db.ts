import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@trader/db";

type Db = ReturnType<typeof drizzle<typeof schema>>;

declare global {
  // eslint-disable-next-line no-var
  var __db: Db | undefined;
}

function createDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 5 });
  return drizzle(sql, { schema });
}

function getInstance(): Db {
  if (!globalThis.__db) {
    globalThis.__db = createDb();
  }
  return globalThis.__db;
}

export const db: Db = new Proxy({} as Db, {
  get(_, prop: string | symbol) {
    return (getInstance() as any)[prop];
  },
});
