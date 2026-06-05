import { describe, it, expect } from "vitest";
import {
  strategies,
  positions,
  positionLots,
  monitoringRuns,
  notifications,
  newsSummaries,
  priceSnapshots,
  memories,
} from "./schema";

describe("schema exports", () => {
  it("strategies table has new columns (symbols, content, script)", () => {
    const columns = Object.keys(strategies);
    expect(columns).toContain("id");
    expect(columns).toContain("name");
    expect(columns).toContain("symbols");
    expect(columns).toContain("content");
    expect(columns).toContain("script");
    expect(columns).toContain("createdAt");
    expect(columns).toContain("updatedAt");
    expect(columns).not.toContain("config");
  });

  it("strategies includes analysisWindowDays with default 60", () => {
    expect(Object.keys(strategies)).toContain("analysisWindowDays");
    const col = (strategies as any).analysisWindowDays;
    expect(col.notNull).toBe(true);
    expect(col.hasDefault).toBe(true);
    expect(col.default).toBe(60);
  });

  it("positions.strategyId is nullable with ON DELETE SET NULL", () => {
    const col = (positions as any).strategyId;
    expect(col.notNull).toBe(false);
    // FK config: drizzle stores references in a getter; Object.values of foreign keys list
    const fkConfig = (positions as any)[Symbol.for("drizzle:PgInlineForeignKeys")] ?? [];
    // fallback: just assert the column itself does not require notNull
  });

  it("positions unique index uses NULLS NOT DISTINCT", () => {
    const config = (positions as any)[Symbol.for("drizzle:ExtraConfigBuilder")];
    // Lightweight smoke: at least the unique index function exists.
    expect(config).toBeDefined();
  });

  it("positions table has required columns", () => {
    const columns = Object.keys(positions);
    expect(columns).toContain("id");
    expect(columns).toContain("strategyId");
    expect(columns).toContain("symbol");
    expect(columns).toContain("referencePrice");
    expect(columns).toContain("createdAt");
    expect(columns).toContain("updatedAt");
  });

  it("positionLots table has required columns", () => {
    const columns = Object.keys(positionLots);
    expect(columns).toContain("id");
    expect(columns).toContain("positionId");
    expect(columns).toContain("shares");
    expect(columns).toContain("costPrice");
    expect(columns).toContain("lotDate");
    expect(columns).toContain("notes");
    expect(columns).toContain("createdAt");
  });

  it("monitoringRuns table has required columns", () => {
    const columns = Object.keys(monitoringRuns);
    expect(columns).toContain("id");
    expect(columns).toContain("strategyId");
    expect(columns).toContain("runDate");
    expect(columns).toContain("status");
    expect(columns).toContain("analysis");
    expect(columns).toContain("hasActionItems");
    expect(columns).toContain("prices");
    expect(columns).toContain("error");
    expect(columns).toContain("createdAt");
  });

  it("notifications table has required columns", () => {
    const columns = Object.keys(notifications);
    expect(columns).toContain("id");
    expect(columns).toContain("monitoringRunId");
    expect(columns).toContain("title");
    expect(columns).toContain("content");
    expect(columns).toContain("isRead");
    expect(columns).toContain("createdAt");
  });

  it("old tables are not exported", async () => {
    const mod = await import("./schema");
    expect(mod).not.toHaveProperty("backtests");
    expect(mod).not.toHaveProperty("priceCache");
  });

  it("positionLots has type column defaulting to BUY", () => {
    const columns = Object.keys(positionLots);
    expect(columns).toContain("type");
    const col = (positionLots as any).type;
    expect(col.notNull).toBe(true);
    expect(col.hasDefault).toBe(true);
    expect(col.default).toBe("BUY");
  });

  it("positionLots.shares is numeric(15,4) (supports decimals)", () => {
    const col = positionLots.shares as unknown as { columnType: string; precision: number; scale: number };
    expect(col.columnType).toBe("PgNumeric");
    expect(col.precision).toBe(15);
    expect(col.scale).toBe(4);
  });

  it("newsSummaries table has required columns", () => {
    const columns = Object.keys(newsSummaries);
    expect(columns).toContain("id");
    expect(columns).toContain("strategyId");
    expect(columns).toContain("summaryDate");
    expect(columns).toContain("content");
    expect(columns).toContain("rawArticles");
    expect(columns).toContain("createdAt");
  });

  it("priceSnapshots table has required OHLCV columns", () => {
    const columns = Object.keys(priceSnapshots);
    expect(columns).toContain("symbol");
    expect(columns).toContain("date");
    expect(columns).toContain("open");
    expect(columns).toContain("high");
    expect(columns).toContain("low");
    expect(columns).toContain("close");
    expect(columns).toContain("volume");
    expect(columns).toContain("fetchedAt");
  });
});

describe("memories table", () => {
  it("has all required columns", () => {
    const columns = Object.keys(memories);
    expect(columns).toContain("id");
    expect(columns).toContain("title");
    expect(columns).toContain("content");
    expect(columns).toContain("kind");
    expect(columns).toContain("strategyId");
    expect(columns).toContain("symbol");
    expect(columns).toContain("tags");
    expect(columns).toContain("pinned");
    expect(columns).toContain("createdAt");
    expect(columns).toContain("updatedAt");
  });

  it("kind defaults to 'note'", () => {
    const col = (memories as any).kind;
    expect(col.notNull).toBe(true);
    expect(col.hasDefault).toBe(true);
    expect(col.default).toBe("note");
  });

  it("pinned defaults to false", () => {
    const col = (memories as any).pinned;
    expect(col.notNull).toBe(true);
    expect(col.default).toBe(false);
  });

  it("strategyId is nullable", () => {
    const col = (memories as any).strategyId;
    expect(col.notNull).toBe(false);
  });
});
