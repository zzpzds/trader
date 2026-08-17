export type PositionTransactionType = "BUY" | "SELL";
export interface PositionTransaction {
    id: string;
    type?: PositionTransactionType | null;
    shares: number;
    price: number;
    date: string;
    createdAt?: string | Date | null;
}
export interface PositionReplayResult {
    heldShares: number;
    costBasis: number;
    avgCost: number;
    grossInvested: number;
    realizedPnl: number;
    isClosed: boolean;
}
export declare function replayPosition(transactions: readonly PositionTransaction[]): PositionReplayResult;
