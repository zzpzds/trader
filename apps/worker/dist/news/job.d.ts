import type { drizzle } from "drizzle-orm/postgres-js";
import type * as schema from "@trader/db";
type DbType = ReturnType<typeof drizzle<typeof schema>>;
export interface RunNewsJobOptions {
    interLlmDelayMs?: number;
}
export declare function runNewsJob(db: DbType, opts?: RunNewsJobOptions): Promise<void>;
export {};
