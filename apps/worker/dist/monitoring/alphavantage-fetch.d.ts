export interface PriceData {
    latest: number;
    bars: Array<{
        date: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
    }>;
}
export interface FetchResult {
    [symbol: string]: PriceData;
}
export declare function isRateLimitError(err: unknown): boolean;
export declare function fetchPrices(symbols: string[], period?: string): Promise<FetchResult>;
