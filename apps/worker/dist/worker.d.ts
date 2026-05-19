import { PgBoss } from "pg-boss";
export declare function createWorker(databaseUrl: string): {
    boss: PgBoss;
    start(): Promise<void>;
    stop(): Promise<void>;
};
