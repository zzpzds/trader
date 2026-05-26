# Strategy Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline description editing and script re-parse to the strategy detail page.

**Architecture:** All changes are in `apps/web/app/strategies/[id]/page.tsx`. No new API routes — uses existing `PUT /api/strategies/[id]` and `POST /api/strategies/parse`. New state variables handle each edit flow independently.

**Tech Stack:** Next.js (App Router), React, TypeScript, Vitest + @testing-library/react, lucide-react, shadcn/ui

---

### Task 1: Description inline editing

**Files:**
- Modify: `apps/web/app/strategies/[id]/page.tsx`
- Test: `apps/web/app/strategies/[id]/__tests__/page.test.tsx`

- [ ] **Step 1: Write failing tests**

Append this new `describe` block to the existing test file `apps/web/app/strategies/[id]/__tests__/page.test.tsx` (after the last closing `}`):

```typescript
describe("StrategyDetailPage description editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch();
  });

  it("description tab shows an edit button", async () => {
    const user = userEvent.setup();
    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));
    await user.click(screen.getByRole("button", { name: "策略描述" }));
    expect(screen.getByRole("button", { name: /edit description/i })).toBeInTheDocument();
  });

  it("clicking edit shows a textarea prefilled with current content", async () => {
    const user = userEvent.setup();
    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));
    await user.click(screen.getByRole("button", { name: "策略描述" }));
    await user.click(screen.getByRole("button", { name: /edit description/i }));
    const textarea = screen.getByRole("textbox", { name: /description input/i });
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue("## 策略描述");
  });

  it("saving calls PUT with updated content and switches back to preview", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "PUT")
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...baseStrategy, content: "## 新描述" }),
        });
      if (url.includes("/api/strategies/strat-1/positions"))
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(baseStrategy) });
    });

    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));
    await user.click(screen.getByRole("button", { name: "策略描述" }));
    await user.click(screen.getByRole("button", { name: /edit description/i }));
    const textarea = screen.getByRole("textbox", { name: /description input/i });
    await user.clear(textarea);
    await user.type(textarea, "## 新描述");
    await user.click(screen.getByRole("button", { name: /^保存$/ }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/strategies/strat-1",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ content: "## 新描述" }),
        })
      );
    });
    expect(screen.queryByRole("textbox", { name: /description input/i })).not.toBeInTheDocument();
  });

  it("cancel restores preview without PUT call", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch();
    global.fetch = fetchMock;

    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));
    await user.click(screen.getByRole("button", { name: "策略描述" }));
    await user.click(screen.getByRole("button", { name: /edit description/i }));
    await user.click(screen.getByRole("button", { name: /取消/ }));

    expect(screen.queryByRole("textbox", { name: /description input/i })).not.toBeInTheDocument();
    const putCalls = fetchMock.mock.calls.filter(
      ([, opts]: [string, RequestInit?]) => opts?.method === "PUT"
    );
    expect(putCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/didi/code/trader
pnpm --filter web test -- --reporter=verbose apps/web/app/strategies/\\[id\\]/__tests__/page.test.tsx 2>&1 | tail -30
```

Expected: 4 new tests FAIL (edit button not found, textarea not found, etc.)

- [ ] **Step 3: Implement description editing**

In `apps/web/app/strategies/[id]/page.tsx`:

**3a — Add imports.** Add `Textarea` import and `RefreshCw, Upload, FileText` to lucide imports (needed for Task 2 but add now to avoid two import edits). Replace the existing lucide import line:

```typescript
import { ArrowLeft, Copy, Plus, Trash2, Edit2, PlayCircle, RefreshCw, Upload, FileText } from "lucide-react";
```

Add after existing imports:

```typescript
import { Textarea } from "@/components/ui/textarea";
import type { ParsedStrategy } from "@/lib/parse-strategy";
```

**3b — Add state variables.** After the `cancelledRef` declaration (line ~67), add:

```typescript
const [editingDescription, setEditingDescription] = useState(false);
const [descriptionInput, setDescriptionInput] = useState("");
const [savingDescription, setSavingDescription] = useState(false);
```

**3c — Add save handler.** After the `handleRenameSave` function, add:

```typescript
async function handleSaveDescription() {
  setSavingDescription(true);
  try {
    const res = await fetch(`/api/strategies/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: descriptionInput }),
    });
    if (res.ok) {
      const updated = await res.json();
      setStrategy((prev) => prev ? { ...prev, content: updated.content } : prev);
      setEditingDescription(false);
    } else {
      alert("保存失败，请重试");
    }
  } catch {
    alert("保存失败，请重试");
  } finally {
    setSavingDescription(false);
  }
}
```

**3d — Replace the description tab JSX.** Replace the entire `{tab === "description" && (...)}` block with:

```tsx
{tab === "description" && (
  <div>
    <div className="flex justify-end mb-2">
      {editingDescription ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSaveDescription} disabled={savingDescription}>
            {savingDescription ? "保存中..." : "保存"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditingDescription(false)}>
            取消
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          aria-label="edit description"
          onClick={() => {
            setDescriptionInput(strategy.content);
            setEditingDescription(true);
          }}
        >
          <Edit2 size={14} />
        </Button>
      )}
    </div>
    {editingDescription ? (
      <Textarea
        aria-label="description input"
        value={descriptionInput}
        onChange={(e) => setDescriptionInput(e.target.value)}
        className="min-h-[300px] font-mono text-sm"
      />
    ) : (
      <div className="prose prose-sm max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{strategy.content}</ReactMarkdown>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/didi/code/trader
pnpm --filter web test -- --reporter=verbose apps/web/app/strategies/\\[id\\]/__tests__/page.test.tsx 2>&1 | tail -30
```

Expected: All tests PASS (both existing rename tests and 4 new description tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/strategies/\\[id\\]/page.tsx apps/web/app/strategies/\\[id\\]/__tests__/page.test.tsx
git commit -m "feat(strategy): add inline description editing"
```

---

### Task 2: Script re-parse panel

**Files:**
- Modify: `apps/web/app/strategies/[id]/page.tsx`
- Test: `apps/web/app/strategies/[id]/__tests__/page.test.tsx`

- [ ] **Step 1: Write failing tests**

Append this `describe` block to the test file after the description editing block:

```typescript
describe("StrategyDetailPage script re-parse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch();
  });

  it("script tab shows a re-parse button", async () => {
    const user = userEvent.setup();
    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));
    await user.click(screen.getByRole("button", { name: "原始脚本" }));
    expect(screen.getByRole("button", { name: /re-parse script/i })).toBeInTheDocument();
  });

  it("clicking re-parse shows the input panel with paste/upload tabs", async () => {
    const user = userEvent.setup();
    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));
    await user.click(screen.getByRole("button", { name: "原始脚本" }));
    await user.click(screen.getByRole("button", { name: /re-parse script/i }));
    expect(screen.getByText("解析脚本")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/粘贴新版/i)).toBeInTheDocument();
  });

  it("parsing calls POST /api/strategies/parse and shows preview", async () => {
    const user = userEvent.setup();
    const parsedResult = { name: "新策略", symbols: ["SPY"], content: "## 新策略描述" };
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes("/api/strategies/parse"))
        return Promise.resolve({ ok: true, json: () => Promise.resolve(parsedResult) });
      if (url.includes("/api/strategies/strat-1/positions"))
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(baseStrategy) });
    });

    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));
    await user.click(screen.getByRole("button", { name: "原始脚本" }));
    await user.click(screen.getByRole("button", { name: /re-parse script/i }));
    await user.type(screen.getByPlaceholderText(/粘贴新版/i), "print('new')");
    await user.click(screen.getByText("解析脚本"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/strategies/parse",
        expect.objectContaining({ method: "POST" })
      );
    });
    await waitFor(() => screen.getByText("确认更新"));
    expect(screen.getByDisplayValue("新策略")).toBeInTheDocument();
  });

  it("confirming PUT calls with all fields and switches to description tab", async () => {
    const user = userEvent.setup();
    const parsedResult = { name: "新策略", symbols: ["SPY"], content: "## 新策略描述" };
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes("/api/strategies/parse"))
        return Promise.resolve({ ok: true, json: () => Promise.resolve(parsedResult) });
      if (opts?.method === "PUT")
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...baseStrategy, ...parsedResult }),
        });
      if (url.includes("/api/strategies/strat-1/positions"))
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(baseStrategy) });
    });

    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));
    await user.click(screen.getByRole("button", { name: "原始脚本" }));
    await user.click(screen.getByRole("button", { name: /re-parse script/i }));
    await user.type(screen.getByPlaceholderText(/粘贴新版/i), "print('new')");
    await user.click(screen.getByText("解析脚本"));
    await waitFor(() => screen.getByText("确认更新"));
    await user.click(screen.getByText("确认更新"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/strategies/strat-1",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            name: "新策略",
            symbols: ["SPY"],
            content: "## 新策略描述",
            script: "print('new')",
          }),
        })
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("确认更新")).not.toBeInTheDocument();
    });
  });

  it("cancel hides the panel without PUT call", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch();
    global.fetch = fetchMock;

    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));
    await user.click(screen.getByRole("button", { name: "原始脚本" }));
    await user.click(screen.getByRole("button", { name: /re-parse script/i }));
    await user.click(screen.getByRole("button", { name: /取消/ }));

    expect(screen.queryByText("解析脚本")).not.toBeInTheDocument();
    const putCalls = fetchMock.mock.calls.filter(
      ([, opts]: [string, RequestInit?]) => opts?.method === "PUT"
    );
    expect(putCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/didi/code/trader
pnpm --filter web test -- --reporter=verbose apps/web/app/strategies/\\[id\\]/__tests__/page.test.tsx 2>&1 | tail -40
```

Expected: 5 new re-parse tests FAIL, all previous tests still PASS

- [ ] **Step 3: Add re-parse state variables and handlers**

In `apps/web/app/strategies/[id]/page.tsx`, after the `savingDescription` state declaration, add:

```typescript
const [showReparse, setShowReparse] = useState(false);
const [reparseTab, setReparseTab] = useState<"upload" | "paste">("paste");
const [reparseScript, setReparseScript] = useState("");
const [reparseParsed, setReparseParsed] = useState<ParsedStrategy | null>(null);
const [reparseEditName, setReparseEditName] = useState("");
const [reparseEditSymbols, setReparseEditSymbols] = useState<string[]>([]);
const [reparsing, setReparsing] = useState(false);
const [savingReparse, setSavingReparse] = useState(false);
```

After the `handleSaveDescription` function, add:

```typescript
async function handleReparse() {
  if (!reparseScript.trim()) return;
  setReparsing(true);
  setReparseParsed(null);
  try {
    const res = await fetch("/api/strategies/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script: reparseScript }),
    });
    const data = await res.json();
    if (data.error) {
      alert(data.error);
      return;
    }
    setReparseParsed(data);
    setReparseEditName(data.name ?? "");
    setReparseEditSymbols(data.symbols ?? []);
  } catch (err) {
    alert("解析失败: " + (err instanceof Error ? err.message : String(err)));
  } finally {
    setReparsing(false);
  }
}

async function handleReparseConfirm() {
  if (!reparseParsed) return;
  setSavingReparse(true);
  try {
    const res = await fetch(`/api/strategies/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: reparseEditName,
        symbols: reparseEditSymbols,
        content: reparseParsed.content,
        script: reparseScript,
      }),
    });
    if (res.ok) {
      await fetchStrategy();
      setShowReparse(false);
      setReparseScript("");
      setReparseParsed(null);
      setTab("description");
    } else {
      alert("更新失败，请重试");
    }
  } catch {
    alert("更新失败，请重试");
  } finally {
    setSavingReparse(false);
  }
}

function handleReparseFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.name.endsWith(".py")) {
    alert("Only .py files are accepted");
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    setReparseScript(ev.target?.result as string);
    setReparseTab("paste");
  };
  reader.readAsText(file);
}
```

- [ ] **Step 4: Replace script tab JSX**

Replace the entire `{tab === "script" && (...)}` block with:

```tsx
{tab === "script" && (
  <div>
    <div className="relative">
      <div className="absolute top-2 right-2 flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          aria-label="re-parse script"
          onClick={() => {
            setShowReparse(!showReparse);
            setReparseParsed(null);
            setReparseScript("");
          }}
        >
          <RefreshCw size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigator.clipboard.writeText(strategy.script)}
        >
          <Copy size={14} />
        </Button>
      </div>
      <pre className="bg-muted p-4 rounded-md text-sm overflow-x-auto">
        <code>{strategy.script}</code>
      </pre>
    </div>

    {showReparse && (
      <div className="mt-4 border rounded-md p-4">
        {!reparseParsed ? (
          <>
            <div className="flex gap-2 mb-4">
              <Button
                variant={reparseTab === "upload" ? "default" : "outline"}
                size="sm"
                onClick={() => setReparseTab("upload")}
              >
                <Upload size={14} className="mr-1" /> 上传文件
              </Button>
              <Button
                variant={reparseTab === "paste" ? "default" : "outline"}
                size="sm"
                onClick={() => setReparseTab("paste")}
              >
                <FileText size={14} className="mr-1" /> 粘贴代码
              </Button>
            </div>
            {reparseTab === "upload" ? (
              <Input type="file" accept=".py" onChange={handleReparseFileUpload} />
            ) : (
              <Textarea
                placeholder="粘贴新版 Python 策略脚本..."
                className="min-h-[200px] font-mono text-sm"
                value={reparseScript}
                onChange={(e) => setReparseScript(e.target.value)}
              />
            )}
            <div className="flex gap-2 mt-4">
              <Button onClick={handleReparse} disabled={reparsing || !reparseScript.trim()}>
                {reparsing ? "解析中..." : "解析脚本"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowReparse(false);
                  setReparseScript("");
                }}
              >
                取消
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">策略名称</label>
              <Input
                value={reparseEditName}
                onChange={(e) => setReparseEditName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">股票代码</label>
              <div className="flex flex-wrap gap-1 mt-1">
                {reparseEditSymbols.map((s, i) => (
                  <Badge key={i} variant="secondary">
                    {s}
                    <button
                      className="ml-1 text-xs hover:text-destructive"
                      onClick={() =>
                        setReparseEditSymbols(reparseEditSymbols.filter((_, j) => j !== i))
                      }
                    >
                      x
                    </button>
                  </Badge>
                ))}
                <Input
                  className="w-24 h-7 text-xs"
                  placeholder="+ 添加"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.currentTarget.value.trim()) {
                      setReparseEditSymbols([
                        ...reparseEditSymbols,
                        e.currentTarget.value.trim().toUpperCase(),
                      ]);
                      e.currentTarget.value = "";
                    }
                  }}
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">新描述预览</label>
              <div className="mt-1 p-3 bg-muted rounded-md text-sm max-h-[400px] overflow-y-auto prose prose-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{reparseParsed.content}</ReactMarkdown>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleReparseConfirm} disabled={savingReparse}>
                {savingReparse ? "更新中..." : "确认更新"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setReparseParsed(null);
                  setReparseScript("");
                }}
              >
                取消
              </Button>
            </div>
          </div>
        )}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 5: Run all tests to verify they pass**

```bash
cd /Users/didi/code/trader
pnpm --filter web test -- --reporter=verbose apps/web/app/strategies/\\[id\\]/__tests__/page.test.tsx 2>&1 | tail -40
```

Expected: All tests PASS (4 rename + 4 description + 5 re-parse = 13 total)

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/strategies/\\[id\\]/page.tsx apps/web/app/strategies/\\[id\\]/__tests__/page.test.tsx
git commit -m "feat(strategy): add script re-parse panel with name/symbols/content update"
```
