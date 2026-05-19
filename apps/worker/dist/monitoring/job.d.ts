import type { drizzle } from "drizzle-orm/postgres-js";
import type * as schema from "@trader/db";
type DbType = ReturnType<typeof drizzle<typeof schema>>;
export declare function runMonitoringJob(db: DbType, strategyId?: string): Promise<void>;
export {};
