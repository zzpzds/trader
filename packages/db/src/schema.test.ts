import { describe, it, expect } from "vitest";
import {
  strategies,
  positions,
  positionLots,
  monitoringRuns,
  notifications,
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

  it("positions table has required columns", () => {
    const columns = Object.keys(positions);
    expect(columns).toContain("id");
    expect(columns).toContain("strategyId");
    expect(columns).toContain("symbol");
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
});
