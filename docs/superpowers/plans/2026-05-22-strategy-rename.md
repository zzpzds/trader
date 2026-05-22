# Strategy Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users rename a strategy by clicking the Edit2 icon next to the name on the detail page.

**Architecture:** Add two state variables (`editingName`, `nameInput`) and a `cancelledRef` to `StrategyDetailPage`. When editing, the `<h1>` is replaced by a disabled-able `<Input>`. Save on Enter/blur; cancel on Esc. Calls existing `PUT /api/strategies/[id]`.

**Tech Stack:** Next.js (App Router), React, Vitest + Testing Library

---

## File Map

| Action | Path |
|--------|------|
| Modify | `apps/web/app/strategies/[id]/page.tsx` |
| Create | `apps/web/app/strategies/[id]/__tests__/page.test.tsx` |

---

### Task 1: Write failing tests for rename behavior

**Files:**
- Create: `apps/web/app/strategies/[id]/__tests__/page.test.tsx`

- [ ] **Step 1: Create the test file**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StrategyDetailPage from "../page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ id: "strat-1" }),
}));

const baseStrategy = {
  id: "strat-1",
  name: "QQQ动量策略",
  symbols: ["QQQ"],
  content: "## 策略描述",
  script: "print('hello')",
};

function mockFetch(strategyData = baseStrategy) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("/api/strategies/strat-1/positions"))
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    if (url.includes("/api/strategies/strat-1"))
      return Promise.resolve({ ok: true, json: () => Promise.resolve(strategyData) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  });
}

describe("StrategyDetailPage rename", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch();
  });

  it("shows the Edit2 icon next to the strategy name", async () => {
    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));
    expect(screen.getByRole("button", { name: /rename/i })).toBeInTheDocument();
  });

  it("clicking Edit2 replaces h1 with a focused input", async () => {
    const user = userEvent.setup();
    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));

    await user.click(screen.getByRole("button", { name: /rename/i }));

    const input = screen.getByRole("textbox", { name: /strategy name/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("QQQ动量策略");
    expect(screen.queryByRole("heading", { name: "QQQ动量策略" })).not.toBeInTheDocument();
  });

  it("pressing Enter saves the new name via PUT", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "PUT")
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...baseStrategy, name: "新名称" }),
        });
      if (url.includes("/api/strategies/strat-1/positions"))
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(baseStrategy) });
    });

    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));

    await user.click(screen.getByRole("button", { name: /rename/i }));
    const input = screen.getByRole("textbox", { name: /strategy name/i });
    await user.clear(input);
    await user.type(input, "新名称");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/strategies/strat-1",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ name: "新名称" }),
        })
      );
    });

    await waitFor(() => screen.getByRole("heading", { name: "新名称" }));
  });

  it("pressing Esc cancels without saving", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch();
    global.fetch = fetchMock;

    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));

    await user.click(screen.getByRole("button", { name: /rename/i }));
    const input = screen.getByRole("textbox", { name: /strategy name/i });
    await user.clear(input);
    await user.type(input, "临时名称");
    await user.keyboard("{Escape}");

    expect(screen.getByRole("heading", { name: "QQQ动量策略" })).toBeInTheDocument();
    const putCalls = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, opts]: [string, RequestInit?]) => opts?.method === "PUT"
    );
    expect(putCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they all fail**

```bash
cd /Users/didi/code/trader
pnpm --filter web test apps/web/app/strategies/[id]/__tests__/page.test.tsx 2>&1 | tail -30
```

Expected: All 4 tests FAIL (StrategyDetailPage has no rename button yet).

---

### Task 2: Implement the rename feature

**Files:**
- Modify: `apps/web/app/strategies/[id]/page.tsx`

- [ ] **Step 1: Add state variables and cancelledRef after the existing `timerRef`**

In `StrategyDetailPage`, after line 63 (`const timerRef = ...`), add:

```tsx
const [editingName, setEditingName] = useState(false);
const [nameInput, setNameInput] = useState("");
const cancelledRef = useRef(false);
```

- [ ] **Step 2: Add the save handler after `handleTrigger`**

Add this function after `handleTrigger` (around line 136):

```tsx
async function handleRenameSave() {
  if (cancelledRef.current) {
    cancelledRef.current = false;
    return;
  }
  const trimmed = nameInput.trim();
  if (!trimmed || trimmed === strategy!.name) {
    setEditingName(false);
    return;
  }
  setEditingName(false);
  try {
    const res = await fetch(`/api/strategies/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (res.ok) {
      const updated = await res.json();
      setStrategy((prev) => prev ? { ...prev, name: updated.name } : prev);
    } else {
      alert("重命名失败，请重试");
    }
  } catch {
    alert("重命名失败，请重试");
  }
}

function handleRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") {
    e.currentTarget.blur();
  } else if (e.key === "Escape") {
    cancelledRef.current = true;
    setEditingName(false);
  }
}
```

- [ ] **Step 3: Replace the static `<h1>` with the conditional name editor**

Find this block in the render (around line 161):

```tsx
<h1 className="text-2xl font-bold">{strategy.name}</h1>
```

Replace it with:

```tsx
{editingName ? (
  <input
    aria-label="strategy name"
    className="text-2xl font-bold bg-transparent border-b border-primary outline-none w-auto min-w-0"
    value={nameInput}
    autoFocus
    onChange={(e) => setNameInput(e.target.value)}
    onKeyDown={handleRenameKeyDown}
    onBlur={handleRenameSave}
  />
) : (
  <h1 className="text-2xl font-bold">{strategy.name}</h1>
)}
<button
  aria-label="rename strategy"
  className="text-muted-foreground hover:text-foreground transition-colors"
  onClick={() => {
    setNameInput(strategy.name);
    setEditingName(true);
  }}
>
  <Edit2 size={16} />
</button>
```

Note: `Edit2` is already imported on line 5 — no import change needed.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/didi/code/trader
pnpm --filter web test apps/web/app/strategies/[id]/__tests__/page.test.tsx 2>&1 | tail -30
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Run full web test suite to check for regressions**

```bash
cd /Users/didi/code/trader
pnpm --filter web test 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/strategies/[id]/page.tsx apps/web/app/strategies/[id]/__tests__/page.test.tsx
git commit -m "feat: inline strategy rename via Edit2 icon on detail page"
```

---

### Task 3: Manual smoke test

- [ ] **Step 1: Start the dev server**

```bash
cd /Users/didi/code/trader
pnpm dev
```

- [ ] **Step 2: Navigate to any strategy detail page**

Open `http://localhost:3000/strategies` → click a strategy.

- [ ] **Step 3: Verify the edit icon appears**

A small pencil icon should appear to the right of the strategy name heading.

- [ ] **Step 4: Test happy path**

Click the pencil icon. The heading becomes an input with the current name selected. Type a new name, press Enter. The heading should update to the new name. Reload the page to confirm the name persisted.

- [ ] **Step 5: Test Esc cancel**

Click the pencil icon. Type something. Press Esc. The original name should reappear without any network call.

- [ ] **Step 6: Test blur save**

Click the pencil icon. Type a new name. Click elsewhere on the page. The name should save.
