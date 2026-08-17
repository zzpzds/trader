"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.replayPosition = replayPosition;
const EPSILON = 1e-9;
function compareDateValues(left, right) {
    const toTimestamp = (value) => {
        const timestamp = value == null ? Number.NaN : new Date(value).getTime();
        return Number.isFinite(timestamp) ? timestamp : 0;
    };
    return toTimestamp(left) - toTimestamp(right);
}
function replayPosition(transactions) {
    const ordered = [...transactions].sort((left, right) => compareDateValues(left.date, right.date) ||
        compareDateValues(left.createdAt, right.createdAt) ||
        left.id.localeCompare(right.id));
    let heldShares = 0;
    let costBasis = 0;
    let grossInvested = 0;
    let realizedPnl = 0;
    for (const transaction of ordered) {
        const type = transaction.type ?? "BUY";
        if (type === "BUY") {
            heldShares += transaction.shares;
            costBasis += transaction.shares * transaction.price;
            grossInvested += transaction.shares * transaction.price;
            continue;
        }
        if (type !== "SELL") {
            throw new Error(`Unknown position transaction type: ${String(type)}`);
        }
        const avgCost = heldShares === 0 ? 0 : costBasis / heldShares;
        heldShares -= transaction.shares;
        costBasis -= transaction.shares * avgCost;
        realizedPnl += transaction.shares * (transaction.price - avgCost);
    }
    if (heldShares < EPSILON) {
        heldShares = 0;
        costBasis = 0;
    }
    return {
        heldShares,
        costBasis,
        avgCost: heldShares === 0 ? 0 : costBasis / heldShares,
        grossInvested,
        realizedPnl,
        isClosed: ordered.length > 0 && heldShares === 0,
    };
}
