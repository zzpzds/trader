// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SkillsImportPage from "../import/page";

interface ManifestEntry {
  name: string;
  description: string | null;
  category: string | null;
  currentBodyHash: string;
  status: "missing" | "in-sync" | "edited";
  source: "seed" | "user" | null;
}

function manifestResponse(data: ManifestEntry[]) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as unknown as Response;
}

function importResponse(
  ok: boolean,
  body: Record<string, unknown>,
  status = ok ? 201 : 400
) {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("SkillsImportPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    // @ts-expect-error - partial fetch mock
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders manifest entries with status badges and action buttons", async () => {
    fetchMock.mockResolvedValueOnce(
      manifestResponse([
        {
          name: "rsi-divergence",
          description: "RSI 背离形态",
          category: "pattern",
          currentBodyHash: "abc",
          status: "missing",
          source: null,
        },
        {
          name: "kelly",
          description: "凯利公式",
          category: "risk",
          currentBodyHash: "def",
          status: "in-sync",
          source: "seed",
        },
        {
          name: "dcf",
          description: "DCF 估值",
          category: "valuation",
          currentBodyHash: "ghi",
          status: "edited",
          source: "seed",
        },
        {
          name: "fomo",
          description: "情绪偏差",
          category: "behavioral",
          currentBodyHash: "jkl",
          status: "edited",
          source: "user",
        },
      ])
    );

    render(<SkillsImportPage />);

    await waitFor(() => {
      expect(screen.getByText("rsi-divergence")).toBeInTheDocument();
    });

    expect(screen.getByText("未导入")).toBeInTheDocument();
    expect(screen.getAllByText("已最新").length).toBeGreaterThan(0);
    expect(screen.getByText("仓库版本已更新")).toBeInTheDocument();
    expect(screen.getByText("已自定义")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "导入" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "同步更新" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "另存为副本" })
    ).toBeInTheDocument();
  });

  it("posts create on 导入 and refetches manifest on success", async () => {
    fetchMock
      // initial manifest load
      .mockResolvedValueOnce(
        manifestResponse([
          {
            name: "rsi-divergence",
            description: "RSI",
            category: "pattern",
            currentBodyHash: "abc",
            status: "missing",
            source: null,
          },
        ])
      )
      // POST import
      .mockResolvedValueOnce(
        importResponse(true, { id: "s1", name: "rsi-divergence" }, 201)
      )
      // refetch manifest
      .mockResolvedValueOnce(
        manifestResponse([
          {
            name: "rsi-divergence",
            description: "RSI",
            category: "pattern",
            currentBodyHash: "abc",
            status: "in-sync",
            source: "seed",
          },
        ])
      );

    render(<SkillsImportPage />);

    const btn = await screen.findByRole("button", { name: "导入" });
    fireEvent.click(btn);

    await waitFor(() => {
      const calls = fetchMock.mock.calls;
      const post = calls.find((c) => c[0] === "/api/skills/seed/import");
      expect(post).toBeDefined();
      expect(post![1]).toMatchObject({
        method: "POST",
        body: JSON.stringify({ name: "rsi-divergence", mode: "create" }),
      });
    });

    // After refetch, status flips to in-sync, button gone
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "导入" })
      ).not.toBeInTheDocument();
    });
    // "已最新" appears as both the status badge and the ml-auto pill
    expect(screen.getAllByText("已最新").length).toBeGreaterThanOrEqual(1);
  });

  it("shows '已创建副本：<name>' on duplicate success", async () => {
    fetchMock
      .mockResolvedValueOnce(
        manifestResponse([
          {
            name: "fomo",
            description: "情绪偏差",
            category: "behavioral",
            currentBodyHash: "jkl",
            status: "edited",
            source: "user",
          },
        ])
      )
      .mockResolvedValueOnce(
        importResponse(true, { id: "s2", name: "fomo-copy" }, 201)
      )
      .mockResolvedValueOnce(
        manifestResponse([
          {
            name: "fomo",
            description: "情绪偏差",
            category: "behavioral",
            currentBodyHash: "jkl",
            status: "edited",
            source: "user",
          },
        ])
      );

    render(<SkillsImportPage />);

    const btn = await screen.findByRole("button", { name: "另存为副本" });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText("已创建副本：fomo-copy")).toBeInTheDocument();
    });

    const post = fetchMock.mock.calls.find(
      (c) => c[0] === "/api/skills/seed/import"
    );
    expect(post![1].body).toBe(
      JSON.stringify({ name: "fomo", mode: "duplicate" })
    );
  });

  it("renders inline error on import failure", async () => {
    fetchMock
      .mockResolvedValueOnce(
        manifestResponse([
          {
            name: "rsi-divergence",
            description: "RSI",
            category: "pattern",
            currentBodyHash: "abc",
            status: "missing",
            source: null,
          },
        ])
      )
      .mockResolvedValueOnce(
        importResponse(false, { error: "name taken" }, 409)
      );

    render(<SkillsImportPage />);

    const btn = await screen.findByRole("button", { name: "导入" });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText("失败：name taken")).toBeInTheDocument();
    });
  });
});
