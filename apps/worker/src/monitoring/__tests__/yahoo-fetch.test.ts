import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "child_process";
import { fetchPrices } from "../yahoo-fetch.js";

function createMockChild(stdout: string, stderr: string, exitCode: number) {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };

  setTimeout(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", exitCode);
  }, 0);

  return child;
}

describe("fetchPrices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed price data on success", async () => {
    const mockData = {
      QQQ: { latest: 185.42, bars: [{ date: "2025-01-02", open: 180, high: 186, low: 179, close: 185.42, volume: 50000000 }] },
    };
    const child = createMockChild(JSON.stringify(mockData), "", 0);
    vi.mocked(spawn).mockReturnValue(child);

    const result = await fetchPrices(["QQQ"]);
    expect(result).toEqual(mockData);
    expect(child.stdin.write).toHaveBeenCalledWith(
      JSON.stringify({ symbols: ["QQQ"], period: "60d" })
    );
  });

  it("rejects on non-zero exit code", async () => {
    const child = createMockChild("", "yfinance error", 1);
    vi.mocked(spawn).mockReturnValue(child);

    await expect(fetchPrices(["BAD"])).rejects.toThrow("yfinance error");
  });

  it("rejects on invalid JSON output", async () => {
    const child = createMockChild("not json", "", 0);
    vi.mocked(spawn).mockReturnValue(child);

    await expect(fetchPrices(["QQQ"])).rejects.toThrow("Failed to parse");
  });

  it("rejects on spawn error", async () => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: vi.fn(), end: vi.fn() };

    setTimeout(() => {
      child.emit("error", new Error("python3 not found"));
    }, 0);

    vi.mocked(spawn).mockReturnValue(child);

    await expect(fetchPrices(["QQQ"])).rejects.toThrow("python3 not found");
  });

  it("uses custom period when provided", async () => {
    const child = createMockChild("{}", "", 0);
    vi.mocked(spawn).mockReturnValue(child);

    await fetchPrices(["SPY"], "30d");
    expect(child.stdin.write).toHaveBeenCalledWith(
      JSON.stringify({ symbols: ["SPY"], period: "30d" })
    );
  });
});
