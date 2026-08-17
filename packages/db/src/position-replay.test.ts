import { describe, expect, it } from "vitest";
import { replayPositionTransactions } from "./position-replay";

describe("replayPositionTransactions", () => {
  it("calculates a weighted average cost for buys", () => {
    expect(
      replayPositionTransactions([
        { id: "buy-1", type: "BUY", shares: 2, price: 100, date: "2026-01-01" },
        { id: "buy-2", type: "BUY", shares: 3, price: 200, date: "2026-01-02" },
      ]),
    ).toEqual({
      heldShares: 5,
      costBasis: 800,
      avgCost: 160,
      grossInvested: 800,
      realizedPnl: 0,
      isClosed: false,
    });
  });

  it("releases cost basis and realizes pnl for a partial sale", () => {
    expect(
      replayPositionTransactions([
        { id: "buy", type: "BUY", shares: 10, price: 100, date: "2026-01-01" },
        { id: "sell", type: "SELL", shares: 4, price: 150, date: "2026-01-02" },
      ]),
    ).toEqual({
      heldShares: 6,
      costBasis: 600,
      avgCost: 100,
      grossInvested: 1000,
      realizedPnl: 200,
      isClosed: false,
    });
  });

  it("marks a fully sold position as closed", () => {
    expect(
      replayPositionTransactions([
        { id: "buy", type: "BUY", shares: 5, price: 100, date: "2026-01-01" },
        { id: "sell", type: "SELL", shares: 5, price: 120, date: "2026-01-02" },
      ]),
    ).toEqual({
      heldShares: 0,
      costBasis: 0,
      avgCost: 0,
      grossInvested: 500,
      realizedPnl: 100,
      isClosed: true,
    });
  });

  it("keeps a reopened position open while preserving realized pnl", () => {
    expect(
      replayPositionTransactions([
        { id: "buy-1", type: "BUY", shares: 5, price: 600, date: "2026-01-01" },
        { id: "sell", type: "SELL", shares: 5, price: 660, date: "2026-01-02" },
        { id: "buy-2", type: "BUY", shares: 5, price: 600, date: "2026-01-03" },
      ]),
    ).toMatchObject({
      heldShares: 5,
      costBasis: 3000,
      avgCost: 600,
      realizedPnl: 300,
      isClosed: false,
    });
  });

  it("replays transactions in date order without mutating its input", () => {
    const transactions = [
      { id: "sell", type: "SELL" as const, shares: 5, price: 120, date: "2026-01-02" },
      { id: "buy", type: "BUY" as const, shares: 5, price: 100, date: "2026-01-01" },
    ];
    const original = structuredClone(transactions);

    expect(replayPositionTransactions(transactions).realizedPnl).toBe(100);
    expect(transactions).toEqual(original);
  });

  it("uses createdAt to order transactions on the same date", () => {
    expect(
      replayPositionTransactions([
        { id: "sell", type: "SELL", shares: 5, price: 120, date: "2026-01-01", createdAt: "2026-01-01T12:00:00Z" },
        { id: "buy", type: "BUY", shares: 5, price: 100, date: "2026-01-01", createdAt: "2026-01-01T09:00:00Z" },
      ]).realizedPnl,
    ).toBe(100);
  });

  it("uses id to order transactions when date and createdAt are equal", () => {
    expect(
      replayPositionTransactions([
        { id: "b-sell", type: "SELL", shares: 5, price: 120, date: "2026-01-01", createdAt: "2026-01-01T09:00:00Z" },
        { id: "a-buy", type: "BUY", shares: 5, price: 100, date: "2026-01-01", createdAt: "2026-01-01T09:00:00Z" },
      ]).realizedPnl,
    ).toBe(100);
  });

  it("treats a missing transaction type as BUY", () => {
    expect(
      replayPositionTransactions([{ id: "buy", shares: 2, price: 50, date: "2026-01-01" }]),
    ).toMatchObject({ heldShares: 2, costBasis: 100, avgCost: 50, grossInvested: 100 });
  });

  it("rejects unknown transaction types", () => {
    expect(() =>
      replayPositionTransactions([
        { id: "unknown", type: "DIVIDEND" as never, shares: 1, price: 1, date: "2026-01-01" },
      ]),
    ).toThrow("Unknown position transaction type: DIVIDEND");
  });
});
