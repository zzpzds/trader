import type { FetchResult } from "./alphavantage-fetch.js";
export declare function upsertSnapshots(db: any, result: FetchResult): Promise<void>;
export declare function ensurePriceSnapshots(db: any, symbol: string, fromDate: string): Promise<void>;
