# Mobile Responsive Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Trader web app usable on mobile phones via responsive Tailwind classes and a bottom tab navigation.

**Architecture:** Two-layer approach — layout layer (Sidebar hidden on mobile, new MobileNav bottom tab) and page layer (each page gets responsive class adjustments). All changes use Tailwind `md:` breakpoint (768px). No new hooks or JS-based device detection.

**Tech Stack:** Next.js (App Router), React, TypeScript, Tailwind CSS, Vitest + @testing-library/react, lucide-react

---

### Task 1: Create MobileNav component

**Files:**
- Create: `apps/web/components/layout/mobile-nav.tsx`
- Create: `apps/web/components/layout/__tests__/mobile-nav.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `apps/web/components/layout/__tests__/mobile-nav.test.tsx`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MobileNav } from "../mobile-nav";

const mockPathname = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

function mockFetchResponse(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

describe("MobileNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    mockPathname.mockReturnValue("/strategies");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders all four tab items", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ unreadCount: 0 })
    );

    render(<MobileNav />);

    await waitFor(() => {
      expect(screen.getByText("策略库")).toBeInTheDocument();
    });
    expect(screen.getByText("持仓")).toBeInTheDocument();
    expect(screen.getByText("监控")).toBeInTheDocument();
    expect(screen.getByText("通知")).toBeInTheDocument();
  });

  it("highlights the active tab based on pathname", async () => {
    mockPathname.mockReturnValue("/positions");
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ unreadCount: 0 })
    );

    render(<MobileNav />);

    await waitFor(() => {
      const activeTab = screen.getByText("持仓").closest("a");
      expect(activeTab?.className).toContain("text-primary");
    });
  });

  it("shows unread badge on notification tab", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ unreadCount: 5 })
    );

    render(<MobileNav />);

    await waitFor(() => {
      expect(screen.getByText("5")).toBeInTheDocument();
    });
  });

  it("does not show badge when unreadCount is 0", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ unreadCount: 0 })
    );

    render(<MobileNav />);

    await waitFor(() => {
      expect(screen.getByText("通知")).toBeInTheDocument();
    });
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/didi/code/trader/apps/web && npx vitest run "mobile-nav" 2>&1 | tail -20
```

Expected: 4 tests FAIL (module not found)

- [ ] **Step 3: Implement MobileNav component**

Create `apps/web/components/layout/mobile-nav.tsx`:

```typescript
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, BarChart3, Eye, Bell } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  {
    href: "/strategies",
    label: "策略库",
    icon: BookOpen,
  },
  {
    href: "/positions",
    label: "持仓",
    icon: BarChart3,
  },
  {
    href: "/monitoring",
    label: "监控",
    icon: Eye,
  },
  {
    href: "/notifications",
    label: "通知",
    icon: Bell,
  },
];

export function MobileNav() {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    async function fetchUnread() {
      try {
        const res = await fetch("/api/notifications?status=unread");
        const data = await res.json();
        setUnreadCount(data.unreadCount ?? 0);
      } catch {
        // ignore
      }
    }
    fetchUnread();
  }, [pathname]);

  return (
    <nav className="flex md:hidden fixed bottom-0 inset-x-0 border-t bg-background h-14 z-50">
      {navItems.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px]",
              active
                ? "text-primary font-medium"
                : "text-muted-foreground"
            )}
          >
            <Icon size={18} />
            {label}
            {href === "/notifications" && unreadCount > 0 && (
              <span className="absolute top-1 right-auto bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/didi/code/trader/apps/web && npx vitest run "mobile-nav" 2>&1 | tail -20
```

Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/didi/code/trader && git add apps/web/components/layout/mobile-nav.tsx apps/web/components/layout/__tests__/mobile-nav.test.tsx && git commit -m "feat(layout): add MobileNav bottom tab component"
```

---

### Task 2: Update layout and Sidebar for responsive behavior

**Files:**
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/components/layout/sidebar.tsx`

- [ ] **Step 1: Update layout.tsx**

In `apps/web/app/layout.tsx`, make three changes:

1. Add MobileNav import after Sidebar import:
```typescript
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
```

2. Add `hidden md:flex` to `<Sidebar>`:
```tsx
<Sidebar />
```
becomes:
```tsx
<Sidebar className="hidden md:flex" />
```

3. Add `<MobileNav />` after `<main>`:
```tsx
<main className="flex-1 overflow-y-auto">{children}</main>
```
becomes:
```tsx
<main className="flex-1 overflow-y-auto pb-14 md:pb-0">{children}</main>
<MobileNav />
```

- [ ] **Step 2: Update Sidebar to accept className prop**

In `apps/web/components/layout/sidebar.tsx`, update the component signature and apply the className:

Replace:
```typescript
export function Sidebar() {
```
with:
```typescript
export function Sidebar({ className }: { className?: string }) {
```

Replace:
```tsx
<aside className="w-56 shrink-0 border-r bg-muted/20 flex flex-col h-full">
```
with:
```tsx
<aside className={cn("w-56 shrink-0 border-r bg-muted/20 flex flex-col h-full", className)}>
```

- [ ] **Step 3: Run existing Sidebar tests to verify they still pass**

```bash
cd /Users/didi/code/trader/apps/web && npx vitest run "sidebar" 2>&1 | tail -15
```

Expected: All existing Sidebar tests PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/didi/code/trader && git add apps/web/app/layout.tsx apps/web/components/layout/sidebar.tsx && git commit -m "feat(layout): hide sidebar on mobile, show bottom tab nav"
```

---

### Task 3: Adapt strategies list page

**Files:**
- Modify: `apps/web/app/strategies/page.tsx`

- [ ] **Step 1: Update responsive classes**

In `apps/web/app/strategies/page.tsx`, make these changes:

1. Replace outer container:
```tsx
<div className="p-6 max-w-4xl mx-auto">
```
with:
```tsx
<div className="p-4 md:p-6 max-w-none md:max-w-4xl mx-auto">
```

2. Update the header row to wrap on mobile. Replace:
```tsx
<div className="flex items-center justify-between mb-6">
```
with:
```tsx
<div className="flex items-center justify-between mb-6 flex-wrap gap-2">
```

- [ ] **Step 2: Run tests to verify nothing breaks**

```bash
cd /Users/didi/code/trader/apps/web && npx vitest run "strategies" 2>&1 | tail -15
```

Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/didi/code/trader && git add apps/web/app/strategies/page.tsx && git commit -m "feat(strategies): responsive padding and max-width"
```

---

### Task 4: Adapt strategy detail page

**Files:**
- Modify: `apps/web/app/strategies/[id]/page.tsx`

- [ ] **Step 1: Update responsive classes on outer container, header, and tabs**

In `apps/web/app/strategies/[id]/page.tsx`:

1. Replace outer container:
```tsx
<div className="h-screen flex flex-col p-6 max-w-4xl mx-auto">
```
with:
```tsx
<div className="h-screen flex flex-col p-4 md:p-6 max-w-none md:max-w-4xl mx-auto">
```

2. Update the title row to wrap on mobile. Replace:
```tsx
<div className="flex items-center gap-3">
```
(the one containing the strategy name, Edit2, symbols, and trigger button)
with:
```tsx
<div className="flex items-center gap-3 flex-wrap">
```

3. Update the internal tab bar to scroll horizontally on mobile. Replace:
```tsx
<div className="flex gap-1 mb-4 border-b shrink-0">
```
with:
```tsx
<div className="flex gap-1 mb-4 border-b shrink-0 overflow-x-auto">
```

- [ ] **Step 2: Update the positions tab — table to card layout**

Replace the entire positions tab block. Find the line:
```tsx
{tab === "positions" && (
```
and replace everything from there up to the matching closing `)}` (before the analysis tab), with:

```tsx
{tab === "positions" && (
  <div className="space-y-4">
    <PnlChart fetchUrl={`/api/strategies/${id}/history`} />

    <div className="flex justify-end">
      <Button size="sm" onClick={() => setShowAddLot(!showAddLot)}>
        <Plus size={14} className="mr-1" /> 新增批次
      </Button>
    </div>

    {showAddLot && (
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">股票代码</label>
              <Input value={lotSymbol} onChange={(e) => setLotSymbol(e.target.value)} placeholder="QQQ" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">股数</label>
              <Input type="number" value={lotShares} onChange={(e) => setLotShares(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">成本价</label>
              <Input type="number" step="0.01" value={lotPrice} onChange={(e) => setLotPrice(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">建仓日期</label>
              <Input type="date" value={lotDate} onChange={(e) => setLotDate(e.target.value)} />
            </div>
            <div className="col-span-1 md:col-span-2">
              <label className="text-xs text-muted-foreground">备注</label>
              <Input value={lotNotes} onChange={(e) => setLotNotes(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={handleAddLot}>保存</Button>
            <Button size="sm" variant="outline" onClick={() => setShowAddLot(false)}>取消</Button>
          </div>
        </CardContent>
      </Card>
    )}

    {positions.map((pos) => {
      const { totalShares, avgCost } = calcAggregated(pos.positionLots);
      const pnl = pos.latestPrice
        ? ((pos.latestPrice - avgCost) / avgCost * 100).toFixed(2)
        : null;
      const pnlPositive = pnl !== null && parseFloat(pnl) >= 0;
      return (
        <div key={pos.id} className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between flex-wrap gap-1 mb-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{pos.symbol}</span>
              <span className="text-sm text-muted-foreground">
                {totalShares} 股 @ ${avgCost.toFixed(2)}
              </span>
            </div>
            {pos.latestPrice !== null ? (
              <span className={`text-sm font-medium ${pnlPositive ? "text-red-600" : "text-green-500"}`}>
                ${pos.latestPrice} &nbsp;
                <span className={`text-xs px-1.5 py-0.5 rounded ${pnlPositive ? "bg-red-50 text-red-700" : "bg-green-50 text-green-600"}`}>
                  {pnlPositive ? "+" : ""}{pnl}%
                </span>
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">--</span>
            )}
          </div>
          <div className="divide-y">
            {pos.positionLots.map((lot) => (
              <div key={lot.id} className="flex items-center justify-between py-2 first:pt-0 last:pb-0 hover:bg-muted/40 transition-colors">
                <div className="flex items-center gap-3 text-sm">
                  <span className="tabular-nums">{lot.lotDate}</span>
                  <span className="tabular-nums">{lot.shares}股</span>
                  <span className="tabular-nums">${parseFloat(lot.costPrice).toFixed(2)}</span>
                  {lot.notes && (
                    <span className="text-muted-foreground text-xs">{lot.notes}</span>
                  )}
                </div>
                <button
                  className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
                  onClick={() => handleDeleteLot(lot.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      );
    })}

    {positions.length === 0 && (
      <p className="text-muted-foreground text-center py-6">暂无持仓记录</p>
    )}
  </div>
)}
```

Key changes from the original:
- Table replaced with card layout — each position is a card with header row + lot list
- `grid-cols-2` → `grid-cols-1 md:grid-cols-2` for add-lot form
- Position header uses `flex-wrap` for price/PnL on small screens
- Lots rendered as flex rows instead of table rows

- [ ] **Step 3: Run tests to verify everything still passes**

```bash
cd /Users/didi/code/trader/apps/web && npx vitest run "strategies" 2>&1 | tail -20
```

Expected: All tests PASS. Note: existing tests use `screen.getByText` and role queries that do not depend on table-vs-card structure.

- [ ] **Step 4: Commit**

```bash
cd /Users/didi/code/trader && git add "apps/web/app/strategies/[id]/page.tsx" && git commit -m "feat(strategy-detail): responsive layout and card-based positions"
```

---

### Task 5: Adapt positions page

**Files:**
- Modify: `apps/web/app/positions/page.tsx`

- [ ] **Step 1: Update responsive classes**

In `apps/web/app/positions/page.tsx`, make these changes:

1. Replace outer container:
```tsx
<div className="p-6 max-w-4xl mx-auto">
```
with:
```tsx
<div className="p-4 md:p-6 max-w-none md:max-w-4xl mx-auto">
```

2. Update the summary stats row to wrap on mobile. Replace:
```tsx
<div className="flex items-end gap-6 flex-wrap">
```
(This already has `flex-wrap`, no change needed — just verify it's there.)

3. Update each position card's content row. Replace:
```tsx
<CardContent className="p-3 flex items-center justify-between">
  <div className="flex items-center gap-3">
```
with:
```tsx
<CardContent className="p-3 flex items-center justify-between flex-wrap gap-1">
  <div className="flex items-center gap-3">
```

- [ ] **Step 2: Run tests to verify nothing breaks**

```bash
cd /Users/didi/code/trader/apps/web && npx vitest run "strategies" 2>&1 | tail -15
```

Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/didi/code/trader && git add apps/web/app/positions/page.tsx && git commit -m "feat(positions): responsive padding and wrapping"
```

---

### Task 6: Adapt monitoring page

**Files:**
- Modify: `apps/web/app/monitoring/page.tsx`

- [ ] **Step 1: Update responsive classes**

In `apps/web/app/monitoring/page.tsx`, make these changes:

1. Replace outer container:
```tsx
<div className="p-6 max-w-4xl mx-auto">
```
with:
```tsx
<div className="p-4 md:p-6 max-w-none md:max-w-4xl mx-auto">
```

2. Replace stats grid:
```tsx
<div className="grid grid-cols-4 gap-3 mb-6">
```
with:
```tsx
<div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
```

3. Replace filter row:
```tsx
<div className="flex gap-3 mb-4">
```
with:
```tsx
<div className="flex gap-3 mb-4 flex-wrap">
```

4. Replace SelectTrigger width:
```tsx
<SelectTrigger className="w-48">
```
with:
```tsx
<SelectTrigger className="w-full md:w-48">
```

5. Update run card header to wrap on mobile. Replace:
```tsx
<div className="flex items-center justify-between">
  <div className="flex items-center gap-3">
    <span className="text-sm font-medium">{run.runDate}</span>
    <span className="text-sm text-muted-foreground">{run.strategyName}</span>
  </div>
  <div className="flex items-center gap-2">
```
with:
```tsx
<div className="flex items-center justify-between flex-wrap gap-1">
  <div className="flex items-center gap-3">
    <span className="text-sm font-medium">{run.runDate}</span>
    <span className="text-sm text-muted-foreground">{run.strategyName}</span>
  </div>
  <div className="flex items-center gap-2">
```

- [ ] **Step 2: Run tests to verify nothing breaks**

```bash
cd /Users/didi/code/trader/apps/web && npx vitest run 2>&1 | tail -15
```

Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/didi/code/trader && git add apps/web/app/monitoring/page.tsx && git commit -m "feat(monitoring): responsive grid and wrapping"
```

---

### Task 7: Adapt notifications page

**Files:**
- Modify: `apps/web/app/notifications/page.tsx`

- [ ] **Step 1: Update responsive classes**

In `apps/web/app/notifications/page.tsx`, make these changes:

1. Replace outer container:
```tsx
<div className="p-6 max-w-4xl mx-auto">
```
with:
```tsx
<div className="p-4 md:p-6 max-w-none md:max-w-4xl mx-auto">
```

2. Replace stats grid:
```tsx
<div className="grid grid-cols-3 gap-3 mb-6">
```
with:
```tsx
<div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
```

3. Replace the filter/actions row:
```tsx
<div className="flex items-center justify-between mb-4">
  <div className="flex items-center gap-2">
```
with:
```tsx
<div className="flex items-center justify-between mb-4 flex-wrap gap-2">
  <div className="flex items-center gap-2 flex-wrap">
```

4. Update notification card row to wrap on mobile. Replace:
```tsx
<div className="flex items-center justify-between">
  <div className="flex items-center gap-3 min-w-0">
```
with:
```tsx
<div className="flex items-center justify-between flex-wrap gap-1">
  <div className="flex items-center gap-3 min-w-0">
```

- [ ] **Step 2: Run all tests to verify nothing breaks**

```bash
cd /Users/didi/code/trader/apps/web && npx vitest run 2>&1 | tail -15
```

Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/didi/code/trader && git add apps/web/app/notifications/page.tsx && git commit -m "feat(notifications): responsive grid and wrapping"
```

---

### Task 8: Final verification and cleanup

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/didi/code/trader/apps/web && npx vitest run 2>&1 | tail -20
```

Expected: All tests PASS

- [ ] **Step 2: Verify no TypeScript errors**

```bash
cd /Users/didi/code/trader/apps/web && npx tsc --noEmit 2>&1 | tail -10
```

Expected: No errors

- [ ] **Step 3: Commit design docs**

```bash
cd /Users/didi/code/trader && git add docs/superpowers/specs/2026-05-26-mobile-responsive-design.md docs/superpowers/plans/2026-05-26-mobile-responsive.md && git commit -m "docs: add mobile responsive adaptation design and plan"
```
