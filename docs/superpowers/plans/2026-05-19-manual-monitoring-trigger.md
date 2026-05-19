# 策略手动触发监控 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在策略详情页 Header 添加"立即分析"按钮，允许用户手动触发单个策略的监控分析。

**Architecture:** 仅修改 `apps/web/app/strategies/[id]/page.tsx`。新增 `triggerStatus` state 管理按钮状态，`handleTrigger()` 调用已有的 `POST /api/monitoring/trigger/[strategyId]` 接口，结果以 inline 提示文字反馈，3 秒后自动清除。API 路由、worker、数据库均不变。

**Tech Stack:** React 19, Next.js App Router, TypeScript, lucide-react, Tailwind CSS

---

### Task 1: 添加触发按钮与状态逻辑

**Files:**
- Modify: `apps/web/app/strategies/[id]/page.tsx`

该任务无需提取新的可测逻辑（纯 React state + fetch），直接实现后通过开发服务器验证。

- [ ] **Step 1: 在 import 行添加 `PlayCircle` 图标**

将第 5 行：
```typescript
import { ArrowLeft, Copy, Plus, Trash2, Edit2 } from "lucide-react";
```
替换为：
```typescript
import { ArrowLeft, Copy, Plus, Trash2, Edit2, PlayCircle } from "lucide-react";
```

- [ ] **Step 2: 在现有 state 声明末尾（第 60 行后）新增 triggerStatus state**

在 `const [lotNotes, setLotNotes] = useState("");` 之后插入：

```typescript
  const [triggerStatus, setTriggerStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
```

- [ ] **Step 3: 在 `handleDeleteLot` 函数后新增 `handleTrigger` 函数**

在 `function calcAggregated` 之前插入：

```typescript
  async function handleTrigger() {
    setTriggerStatus("loading");
    try {
      const res = await fetch(`/api/monitoring/trigger/${id}`, { method: "POST" });
      setTriggerStatus(res.ok ? "success" : "error");
    } catch {
      setTriggerStatus("error");
    } finally {
      setTimeout(() => setTriggerStatus("idle"), 3000);
    }
  }
```

- [ ] **Step 4: 更新 Header 区域，添加按钮和状态提示**

将现有 Header 块（第 133–143 行）：
```tsx
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <Button variant="ghost" size="sm" onClick={() => router.push("/strategies")}>
          <ArrowLeft size={16} />
        </Button>
        <h1 className="text-2xl font-bold">{strategy.name}</h1>
        <div className="flex gap-1">
          {strategy.symbols?.map((s) => (
            <Badge key={s} variant="outline">{s}</Badge>
          ))}
        </div>
      </div>
```
替换为：
```tsx
      <div className="shrink-0 mb-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push("/strategies")}>
            <ArrowLeft size={16} />
          </Button>
          <h1 className="text-2xl font-bold">{strategy.name}</h1>
          <div className="flex gap-1">
            {strategy.symbols?.map((s) => (
              <Badge key={s} variant="outline">{s}</Badge>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={triggerStatus === "loading"}
            onClick={handleTrigger}
          >
            <PlayCircle size={14} className="mr-1" />
            {triggerStatus === "loading" ? "触发中..." : "立即分析"}
          </Button>
        </div>
        {triggerStatus === "success" && (
          <p className="text-xs text-muted-foreground mt-1.5 ml-10">
            ✓ 分析已触发，稍后在「最近分析」Tab 查看结果
          </p>
        )}
        {triggerStatus === "error" && (
          <p className="text-xs text-destructive mt-1.5 ml-10">
            触发失败，请重试
          </p>
        )}
      </div>
```

- [ ] **Step 5: 启动开发服务器验证**

```bash
cd /Users/didi/code/trader/apps/web && npm run dev
```

打开 `http://localhost:3000/strategies/<任意策略id>`，验证：
1. Header 右侧出现"立即分析"按钮
2. 点击后按钮变为"触发中..."并禁用
3. API 响应后出现成功提示文字
4. 3 秒后提示文字消失，按钮恢复可用
5. 切换到"最近分析" Tab，确认有新的 pending/completed 记录出现

- [ ] **Step 6: 提交**

```bash
git add apps/web/app/strategies/\[id\]/page.tsx
git commit -m "feat: 策略详情页添加手动触发监控按钮"
```
