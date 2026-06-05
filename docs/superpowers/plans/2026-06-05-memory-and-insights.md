# Memory Notes + Trade Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-writable notes feature with full-text search that gets pre-loaded into the monitoring LLM prompt, plus an `/insights` page showing 4 categories of trade-behavior diagnostics computed from existing position lots.

**Architecture:** New `memories` table with `pg_trgm` GIN indexes for CJK-friendly fuzzy search. Web app gets `/memory` and `/insights` pages. Worker's `analyze.ts` accepts a new `memories` parameter and the prompt includes them; `job.ts` fetches relevant memories before each strategy analysis. Insights are computed on-demand from `positionLots` + `priceSnapshots` (no new tables, no caching in v1).

**Tech Stack:** Drizzle ORM 0.45, PostgreSQL 16 + pg_trgm contrib, Next.js 16 App Router, Vitest, shadcn/ui, lucide-react icons, Anthropic SDK.

**Spec:** `docs/superpowers/specs/2026-06-05-memory-and-insights-design.md`

---

## Phase A — Memory Schema

### Task A1: Add `memories` table to drizzle schema

**Files:**
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Add table definition + relations**

Append to `packages/db/src/schema.ts`, after the `priceSnapshots` block, before the relations block (around line 156):

```ts
export const memories = pgTable(
  "memories",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    title: text("title").notNull(),
    content: text("content").notNull(),
    kind: text("kind", { enum: ["note", "idea", "lesson", "context"] })
      .notNull()
      .default("note"),
    strategyId: text("strategy_id").references(() => strategies.id, {
      onDelete: "set null",
    }),
    symbol: text("symbol"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("memories_strategy_idx").on(t.strategyId),
    index("memories_symbol_idx").on(t.symbol),
    index("memories_pinned_idx").on(t.pinned),
  ]
);

export type MemoryRow = typeof memories.$inferSelect;
export type NewMemoryRow = typeof memories.$inferInsert;

export const memoriesRelations = relations(memories, ({ one }) => ({
  strategy: one(strategies, {
    fields: [memories.strategyId],
    references: [strategies.id],
  }),
}));
```

Also add `memories: many(memories)` to the existing `strategiesRelations`:

```ts
export const strategiesRelations = relations(strategies, ({ many }) => ({
  positions: many(positions),
  monitoringRuns: many(monitoringRuns),
  newsSummaries: many(newsSummaries),
  memories: many(memories),
}));
```

- [ ] **Step 2: Run schema test to verify it still compiles**

Run: `cd packages/db && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat(db): add memories table to schema"
```

---

### Task A2: Bootstrap pg_trgm extension + GIN indexes

**Files:**
- Create: `packages/db/scripts/ensure-pg-extensions.ts`
- Modify: `packages/db/package.json`
- Modify: `Dockerfile` (db-migrate target)

- [ ] **Step 1: Create the bootstrap script**

```ts
// packages/db/scripts/ensure-pg-extensions.ts
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[ensure-pg-extensions] DATABASE_URL not set");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1 });
  try {
    await sql.unsafe("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    await sql.unsafe(
      `CREATE INDEX IF NOT EXISTS memories_title_trgm_idx
       ON memories USING gin (title gin_trgm_ops)`
    );
    await sql.unsafe(
      `CREATE INDEX IF NOT EXISTS memories_content_trgm_idx
       ON memories USING gin (content gin_trgm_ops)`
    );
    console.log("[ensure-pg-extensions] pg_trgm + GIN indexes ready");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[ensure-pg-extensions]", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script in `packages/db/package.json`**

In the `scripts` block, add right after `db:push`:

```json
"db:setup-extensions": "dotenv -e ../../.env -- tsx scripts/ensure-pg-extensions.ts",
"db:migrate": "npm run db:push && npm run db:setup-extensions"
```

- [ ] **Step 3: Update `Dockerfile` db-migrate target**

Find:

```dockerfile
FROM base AS db-migrate
COPY . .
RUN npm run build -w packages/db
WORKDIR /app/packages/db
CMD ["npx", "drizzle-kit", "push"]
```

Change `CMD` to chain extension setup after push:

```dockerfile
CMD ["sh", "-c", "npx drizzle-kit push && npx tsx scripts/ensure-pg-extensions.ts"]
```

- [ ] **Step 4: Verify locally — run schema push then bootstrap**

Run: `cd packages/db && npm run db:migrate`

Expected output ending with: `[ensure-pg-extensions] pg_trgm + GIN indexes ready`

- [ ] **Step 5: Verify the indexes exist**

Run: `psql "$DATABASE_URL" -c "\\d memories"` (or the equivalent against your local Postgres)

Expected: lists `memories_title_trgm_idx` and `memories_content_trgm_idx` (gin index lines)

- [ ] **Step 6: Commit**

```bash
git add packages/db/scripts/ensure-pg-extensions.ts packages/db/package.json Dockerfile
git commit -m "feat(db): bootstrap pg_trgm extension + GIN indexes for memories"
```

---

### Task A3: Schema smoke test for memories

**Files:**
- Modify: `packages/db/src/schema.test.ts`

- [ ] **Step 1: Add import + describe block**

Add `memories` to the import at the top:

```ts
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
```

Append a new `describe` block at the end of the file:

```ts
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
```

- [ ] **Step 2: Run the test**

Run: `cd packages/db && npm test`
Expected: all tests pass, including the four new ones

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema.test.ts
git commit -m "test(db): cover memories table columns"
```

---

## Phase B — Memory Backend

### Task B1: `memory-search.ts` query helpers + tests

**Files:**
- Create: `apps/web/lib/memory-search.ts`
- Create: `apps/web/lib/__tests__/memory-search.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/__tests__/memory-search.test.ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { buildMemoryListQuery } from "../memory-search";

describe("buildMemoryListQuery", () => {
  it("falls back to LIKE when q.length < 2", () => {
    const q = buildMemoryListQuery({ q: "a" });
    expect(q.searchMode).toBe("like");
    expect(q.likePattern).toBe("%a%");
  });

  it("uses pg_trgm when q.length >= 2", () => {
    const q = buildMemoryListQuery({ q: "NVDA" });
    expect(q.searchMode).toBe("trgm");
    expect(q.trgmThreshold).toBe(0.1);
  });

  it("ignores empty q", () => {
    const q = buildMemoryListQuery({});
    expect(q.searchMode).toBe("none");
  });

  it("clamps limit to [1, 100], default 20", () => {
    expect(buildMemoryListQuery({}).limit).toBe(20);
    expect(buildMemoryListQuery({ limit: 200 }).limit).toBe(100);
    expect(buildMemoryListQuery({ limit: 0 }).limit).toBe(1);
  });

  it("preserves filter fields", () => {
    const q = buildMemoryListQuery({
      strategyId: "s1",
      symbol: "AAPL",
      kind: "idea",
      pinned: true,
    });
    expect(q.filters).toMatchObject({
      strategyId: "s1",
      symbol: "AAPL",
      kind: "idea",
      pinned: true,
    });
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd apps/web && npx vitest run lib/__tests__/memory-search.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```ts
// apps/web/lib/memory-search.ts
export interface MemoryListParams {
  q?: string;
  strategyId?: string;
  symbol?: string;
  kind?: "note" | "idea" | "lesson" | "context";
  pinned?: boolean;
  limit?: number;
}

export interface MemoryListQuery {
  searchMode: "none" | "like" | "trgm";
  likePattern?: string;
  trgmQuery?: string;
  trgmThreshold: number;
  filters: {
    strategyId?: string;
    symbol?: string;
    kind?: string;
    pinned?: boolean;
  };
  limit: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const TRGM_THRESHOLD = 0.1;

export function buildMemoryListQuery(params: MemoryListParams): MemoryListQuery {
  const limitRaw = params.limit ?? DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limitRaw)));

  const q = params.q?.trim() ?? "";
  let searchMode: MemoryListQuery["searchMode"] = "none";
  let likePattern: string | undefined;
  let trgmQuery: string | undefined;

  if (q.length === 0) {
    searchMode = "none";
  } else if (q.length < 2) {
    searchMode = "like";
    likePattern = `%${q}%`;
  } else {
    searchMode = "trgm";
    trgmQuery = q;
  }

  return {
    searchMode,
    likePattern,
    trgmQuery,
    trgmThreshold: TRGM_THRESHOLD,
    filters: {
      strategyId: params.strategyId,
      symbol: params.symbol,
      kind: params.kind,
      pinned: params.pinned,
    },
    limit,
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd apps/web && npx vitest run lib/__tests__/memory-search.test.ts`
Expected: PASS — all 5 cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/memory-search.ts apps/web/lib/__tests__/memory-search.test.ts
git commit -m "feat(web): memory list query builder with trgm/like fallback"
```

---

### Task B2: `/api/memories` route (GET list + POST create)

**Files:**
- Create: `apps/web/app/api/memories/route.ts`
- Create: `apps/web/app/api/memories/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/api/memories/__tests__/route.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecute, mockInsertReturning } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockInsertReturning: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    execute: mockExecute,
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: mockInsertReturning,
      })),
    })),
  },
}));

import { GET, POST } from "../route";

function makeReq(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/memories");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url);
}

describe("GET /api/memories", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("returns rows from db.execute", async () => {
    mockExecute.mockResolvedValueOnce([
      { id: "m1", title: "t", content: "c", kind: "note", pinned: false },
    ]);
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("m1");
  });

  it("invokes db.execute with q filter (trigram path)", async () => {
    mockExecute.mockResolvedValueOnce([]);
    const res = await GET(makeReq({ q: "NVDA" }));
    expect(res.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/memories", () => {
  beforeEach(() => {
    mockInsertReturning.mockReset();
  });

  it("creates memory with required fields", async () => {
    mockInsertReturning.mockResolvedValueOnce([
      { id: "m1", title: "T", content: "C", kind: "note" },
    ]);
    const res = await POST(
      new Request("http://localhost/api/memories", {
        method: "POST",
        body: JSON.stringify({ title: "T", content: "C" }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe("m1");
  });

  it("rejects when title missing", async () => {
    const res = await POST(
      new Request("http://localhost/api/memories", {
        method: "POST",
        body: JSON.stringify({ content: "C" }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects when content missing", async () => {
    const res = await POST(
      new Request("http://localhost/api/memories", {
        method: "POST",
        body: JSON.stringify({ title: "T" }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd apps/web && npx vitest run app/api/memories/__tests__/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

```ts
// apps/web/app/api/memories/route.ts
export const dynamic = "force-dynamic";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { memories } from "@trader/db";
import { buildMemoryListQuery, type MemoryListParams } from "@/lib/memory-search";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params: MemoryListParams = {
    q: url.searchParams.get("q") ?? undefined,
    strategyId: url.searchParams.get("strategyId") ?? undefined,
    symbol: url.searchParams.get("symbol") ?? undefined,
    kind: (url.searchParams.get("kind") as MemoryListParams["kind"]) ?? undefined,
    pinned:
      url.searchParams.get("pinned") === "true"
        ? true
        : url.searchParams.get("pinned") === "false"
        ? false
        : undefined,
    limit: url.searchParams.get("limit")
      ? Number(url.searchParams.get("limit"))
      : undefined,
  };

  const q = buildMemoryListQuery(params);

  const wheres: any[] = [];
  if (q.filters.strategyId) wheres.push(sql`strategy_id = ${q.filters.strategyId}`);
  if (q.filters.symbol) wheres.push(sql`symbol = ${q.filters.symbol}`);
  if (q.filters.kind) wheres.push(sql`kind = ${q.filters.kind}`);
  if (q.filters.pinned !== undefined) wheres.push(sql`pinned = ${q.filters.pinned}`);

  let orderBy = sql`pinned DESC, updated_at DESC`;

  if (q.searchMode === "trgm") {
    wheres.push(
      sql`(similarity(title, ${q.trgmQuery!}) > ${q.trgmThreshold}
           OR similarity(content, ${q.trgmQuery!}) > ${q.trgmThreshold})`
    );
    orderBy = sql`GREATEST(similarity(title, ${q.trgmQuery!}), similarity(content, ${q.trgmQuery!})) DESC, updated_at DESC`;
  } else if (q.searchMode === "like") {
    wheres.push(
      sql`(title ILIKE ${q.likePattern!} OR content ILIKE ${q.likePattern!})`
    );
  }

  const whereClause = wheres.length
    ? sql.join([sql`WHERE`, sql.join(wheres, sql` AND `)], sql` `)
    : sql``;

  const rows = await db.execute(
    sql`SELECT id, title, content, kind, strategy_id AS "strategyId", symbol, tags, pinned,
               created_at AS "createdAt", updated_at AS "updatedAt"
        FROM memories
        ${whereClause}
        ORDER BY ${orderBy}
        LIMIT ${q.limit}`
  );

  return Response.json(rows);
}

const VALID_KINDS = new Set(["note", "idea", "lesson", "context"]);

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const {
    title,
    content,
    kind,
    strategyId,
    symbol,
    tags,
    pinned,
  } = body as {
    title?: string;
    content?: string;
    kind?: string;
    strategyId?: string | null;
    symbol?: string | null;
    tags?: string[];
    pinned?: boolean;
  };

  if (!title || typeof title !== "string") {
    return Response.json({ error: "title is required" }, { status: 400 });
  }
  if (!content || typeof content !== "string") {
    return Response.json({ error: "content is required" }, { status: 400 });
  }
  if (kind !== undefined && !VALID_KINDS.has(kind)) {
    return Response.json({ error: "invalid kind" }, { status: 400 });
  }

  const [row] = await db
    .insert(memories)
    .values({
      title,
      content,
      kind: (kind as "note" | "idea" | "lesson" | "context") ?? "note",
      strategyId: strategyId ?? null,
      symbol: symbol ?? null,
      tags: tags ?? [],
      pinned: pinned ?? false,
    })
    .returning();

  return Response.json(row, { status: 201 });
}
```

- [ ] **Step 4: Run the tests, verify pass**

Run: `cd apps/web && npx vitest run app/api/memories/__tests__/route.test.ts`
Expected: PASS — all 5 cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/memories
git commit -m "feat(web): GET/POST /api/memories with trgm search"
```

---

### Task B3: `/api/memories/[id]` route (GET, PATCH, DELETE)

**Files:**
- Create: `apps/web/app/api/memories/[id]/route.ts`
- Create: `apps/web/app/api/memories/[id]/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/api/memories/[id]/__tests__/route.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindFirst, mockUpdateReturning, mockDeleteReturning } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockUpdateReturning: vi.fn(),
  mockDeleteReturning: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: { memories: { findFirst: mockFindFirst } },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ returning: mockUpdateReturning })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({ returning: mockDeleteReturning })),
    })),
  },
}));

import { GET, PATCH, DELETE } from "../route";

const makeCtx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/memories/:id", () => {
  beforeEach(() => mockFindFirst.mockReset());

  it("returns 404 when not found", async () => {
    mockFindFirst.mockResolvedValueOnce(undefined);
    const res = await GET(new Request("http://localhost"), makeCtx("missing"));
    expect(res.status).toBe(404);
  });

  it("returns the row when found", async () => {
    mockFindFirst.mockResolvedValueOnce({ id: "m1", title: "t" });
    const res = await GET(new Request("http://localhost"), makeCtx("m1"));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("m1");
  });
});

describe("PATCH /api/memories/:id", () => {
  beforeEach(() => mockUpdateReturning.mockReset());

  it("updates allowed fields", async () => {
    mockUpdateReturning.mockResolvedValueOnce([
      { id: "m1", title: "new title" },
    ]);
    const res = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ title: "new title", pinned: true }),
        headers: { "Content-Type": "application/json" },
      }),
      makeCtx("m1")
    );
    expect(res.status).toBe(200);
  });

  it("returns 404 when row missing", async () => {
    mockUpdateReturning.mockResolvedValueOnce([]);
    const res = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ title: "x" }),
        headers: { "Content-Type": "application/json" },
      }),
      makeCtx("missing")
    );
    expect(res.status).toBe(404);
  });

  it("rejects invalid kind", async () => {
    const res = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ kind: "bogus" }),
        headers: { "Content-Type": "application/json" },
      }),
      makeCtx("m1")
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/memories/:id", () => {
  beforeEach(() => mockDeleteReturning.mockReset());

  it("returns 204 on success", async () => {
    mockDeleteReturning.mockResolvedValueOnce([{ id: "m1" }]);
    const res = await DELETE(new Request("http://localhost"), makeCtx("m1"));
    expect(res.status).toBe(204);
  });

  it("returns 404 when not found", async () => {
    mockDeleteReturning.mockResolvedValueOnce([]);
    const res = await DELETE(new Request("http://localhost"), makeCtx("missing"));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd apps/web && npx vitest run app/api/memories/[id]/__tests__/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

```ts
// apps/web/app/api/memories/[id]/route.ts
export const dynamic = "force-dynamic";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { memories } from "@trader/db";

const VALID_KINDS = new Set(["note", "idea", "lesson", "context"]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const row = await db.query.memories.findFirst({
    where: eq(memories.id, id),
  });
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(row);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.length === 0)
      return Response.json({ error: "invalid title" }, { status: 400 });
    updates.title = body.title;
  }
  if (body.content !== undefined) {
    if (typeof body.content !== "string")
      return Response.json({ error: "invalid content" }, { status: 400 });
    updates.content = body.content;
  }
  if (body.kind !== undefined) {
    if (!VALID_KINDS.has(body.kind))
      return Response.json({ error: "invalid kind" }, { status: 400 });
    updates.kind = body.kind;
  }
  if (body.strategyId !== undefined) updates.strategyId = body.strategyId ?? null;
  if (body.symbol !== undefined) updates.symbol = body.symbol ?? null;
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags))
      return Response.json({ error: "tags must be an array" }, { status: 400 });
    updates.tags = body.tags;
  }
  if (body.pinned !== undefined) updates.pinned = !!body.pinned;

  const rows = await db
    .update(memories)
    .set(updates)
    .where(eq(memories.id, id))
    .returning();

  if (rows.length === 0)
    return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(rows[0]);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rows = await db
    .delete(memories)
    .where(eq(memories.id, id))
    .returning();
  if (rows.length === 0)
    return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/web && npx vitest run app/api/memories/[id]/__tests__/route.test.ts`
Expected: PASS — all 7 cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/memories/\[id\]
git commit -m "feat(web): GET/PATCH/DELETE /api/memories/:id"
```

---

## Phase C — Memory UI

### Task C1: Add nav links to sidebar + mobile nav

**Files:**
- Modify: `apps/web/components/layout/sidebar.tsx`
- Modify: `apps/web/components/layout/mobile-nav.tsx`

- [ ] **Step 1: Edit sidebar.tsx — add icon import + nav items**

In the import line `import { BookOpen, BarChart3, Eye, Bell, Newspaper } from "lucide-react";`, add `StickyNote, LineChart`:

```ts
import { BookOpen, BarChart3, Eye, Bell, Newspaper, StickyNote, LineChart } from "lucide-react";
```

Insert two items into `navItems` after `notifications`:

```ts
const navItems = [
  { href: "/positions", label: "持仓管理", icon: BarChart3 },
  { href: "/news", label: "热点", icon: Newspaper },
  { href: "/strategies", label: "策略库", icon: BookOpen },
  { href: "/monitoring", label: "监控中心", icon: Eye },
  { href: "/notifications", label: "通知", icon: Bell },
  { href: "/memory", label: "笔记", icon: StickyNote },
  { href: "/insights", label: "行为诊断", icon: LineChart },
];
```

- [ ] **Step 2: Edit mobile-nav.tsx — same changes**

Add `StickyNote, LineChart` to the same import line, and append the two nav items the same way (mobile uses shorter labels — use `"笔记"` and `"诊断"`).

- [ ] **Step 3: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/layout/sidebar.tsx apps/web/components/layout/mobile-nav.tsx
git commit -m "feat(web): add memory + insights nav links"
```

---

### Task C2: `/memory` page — list, search, dialog

**Files:**
- Create: `apps/web/app/memory/page.tsx`
- Create: `apps/web/components/memory-dialog.tsx`

- [ ] **Step 1: Create the dialog component**

```tsx
// apps/web/components/memory-dialog.tsx
"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface MemoryFormValues {
  id?: string;
  title: string;
  content: string;
  kind: "note" | "idea" | "lesson" | "context";
  strategyId: string | null;
  symbol: string | null;
  tags: string[];
  pinned: boolean;
}

interface Strategy {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  initial: Partial<MemoryFormValues>;
  strategies: Strategy[];
  onClose: () => void;
  onSaved: () => void;
}

const KINDS: Array<{ value: MemoryFormValues["kind"]; label: string }> = [
  { value: "note", label: "复盘笔记" },
  { value: "idea", label: "想法/假设" },
  { value: "lesson", label: "经验教训" },
  { value: "context", label: "背景资料" },
];

export function MemoryDialog({ open, initial, strategies, onClose, onSaved }: Props) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<MemoryFormValues["kind"]>("note");
  const [strategyId, setStrategyId] = useState<string>("");
  const [symbol, setSymbol] = useState("");
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(initial.title ?? "");
      setContent(initial.content ?? "");
      setKind(initial.kind ?? "note");
      setStrategyId(initial.strategyId ?? "");
      setSymbol(initial.symbol ?? "");
      setPinned(initial.pinned ?? false);
    }
  }, [open, initial]);

  async function handleSave() {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      const body = {
        title,
        content,
        kind,
        strategyId: strategyId || null,
        symbol: symbol || null,
        pinned,
      };
      const url = initial.id ? `/api/memories/${initial.id}` : "/api/memories";
      const method = initial.id ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!initial.id) return;
    if (!confirm("确认删除这条笔记？")) return;
    await fetch(`/api/memories/${initial.id}`, { method: "DELETE" });
    onSaved();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial.id ? "编辑笔记" : "新建笔记"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="标题" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea
            placeholder="内容"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
          />
          <div className="flex gap-2 flex-wrap">
            <select value={kind} onChange={(e) => setKind(e.target.value as MemoryFormValues["kind"])} className="border rounded px-2 py-1 text-sm">
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
            <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)} className="border rounded px-2 py-1 text-sm">
              <option value="">（不绑定策略）</option>
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <Input
              placeholder="标的（可选，如 NVDA）"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              className="w-40"
            />
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
              置顶（注入 prompt）
            </label>
          </div>
        </div>
        <DialogFooter>
          {initial.id && (
            <Button variant="destructive" onClick={handleDelete}>删除</Button>
          )}
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSave} disabled={saving || !title.trim() || !content.trim()}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create the memory page**

```tsx
// apps/web/app/memory/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { Pin, Search, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MemoryDialog, type MemoryFormValues } from "@/components/memory-dialog";

interface Memory {
  id: string;
  title: string;
  content: string;
  kind: "note" | "idea" | "lesson" | "context";
  strategyId: string | null;
  symbol: string | null;
  tags: string[];
  pinned: boolean;
  updatedAt: string;
}

interface Strategy { id: string; name: string }

const KIND_LABEL: Record<Memory["kind"], string> = {
  note: "复盘",
  idea: "想法",
  lesson: "教训",
  context: "背景",
};

export default function MemoryPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [q, setQ] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("");
  const [strategyFilter, setStrategyFilter] = useState<string>("");
  const [editing, setEditing] = useState<Partial<MemoryFormValues> | null>(null);

  const fetchMemories = useCallback(async () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (kindFilter) params.set("kind", kindFilter);
    if (strategyFilter) params.set("strategyId", strategyFilter);
    const res = await fetch(`/api/memories?${params}`);
    setMemories(await res.json());
  }, [q, kindFilter, strategyFilter]);

  useEffect(() => {
    const t = setTimeout(fetchMemories, 300);
    return () => clearTimeout(t);
  }, [fetchMemories]);

  useEffect(() => {
    fetch("/api/strategies")
      .then((r) => r.json())
      .then(setStrategies);
  }, []);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-60">
          <Search size={14} className="absolute left-2 top-2.5 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索笔记…"
            className="pl-7"
          />
        </div>
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className="border rounded px-2 py-1 text-sm">
          <option value="">全部类型</option>
          {Object.entries(KIND_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select value={strategyFilter} onChange={(e) => setStrategyFilter(e.target.value)} className="border rounded px-2 py-1 text-sm">
          <option value="">全部策略</option>
          {strategies.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <Button onClick={() => setEditing({})}>
          <Plus size={14} /> 新建笔记
        </Button>
      </div>

      {memories.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          还没有笔记，monitoring 时不会注入任何上下文。
        </p>
      )}

      <div className="grid gap-2">
        {memories.map((m) => {
          const strat = strategies.find((s) => s.id === m.strategyId);
          return (
            <Card key={m.id} className="cursor-pointer hover:shadow" onClick={() => setEditing({
              id: m.id,
              title: m.title,
              content: m.content,
              kind: m.kind,
              strategyId: m.strategyId,
              symbol: m.symbol,
              tags: m.tags,
              pinned: m.pinned,
            })}>
              <CardContent className="py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {m.pinned && <Pin size={12} className="text-amber-600" />}
                  <span className="font-medium">{m.title}</span>
                  <Badge variant="outline" className="text-[10px]">{KIND_LABEL[m.kind]}</Badge>
                  {strat && <Badge variant="secondary" className="text-[10px]">{strat.name}</Badge>}
                  {m.symbol && <Badge variant="secondary" className="text-[10px]">{m.symbol}</Badge>}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {new Date(m.updatedAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{m.content}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {editing !== null && (
        <MemoryDialog
          open={true}
          initial={editing}
          strategies={strategies}
          onClose={() => setEditing(null)}
          onSaved={fetchMemories}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`
- Visit `/memory`
- Click "新建笔记", fill title + content, save
- See it appear in the list
- Click the card, edit, save, see update
- Search for a substring, verify filtering
- Toggle pinned, verify pin icon shows

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/memory apps/web/components/memory-dialog.tsx
git commit -m "feat(web): /memory page with list, search, CRUD dialog"
```

---

### Task C3: `/strategies/[id]` — Notes tab

**Files:**
- Modify: `apps/web/app/strategies/[id]/page.tsx`

- [ ] **Step 1: Extend the Tab type and add Notes tab**

Find the line `type Tab = "description" | "script" | "positions" | "analysis";` and change to:

```ts
type Tab = "description" | "script" | "positions" | "analysis" | "notes";
```

- [ ] **Step 2: Add tab button in the tab nav row**

Find the existing tab buttons in the JSX (search for `setTab("analysis")`) and add a sibling button next to them:

```tsx
<button
  onClick={() => setTab("notes")}
  className={cn(
    "px-3 py-1.5 text-sm rounded-md",
    tab === "notes" ? "bg-primary text-primary-foreground" : "hover:bg-accent"
  )}
>
  笔记
</button>
```

(If the file does not import `cn`, add `import { cn } from "@/lib/utils";` to the imports.)

- [ ] **Step 3: Add tab panel rendering**

Find the conditional rendering (e.g. `{tab === "analysis" && (...)}`) and add a sibling block after it:

```tsx
{tab === "notes" && (
  <NotesPanel strategyId={id} />
)}
```

Add the `NotesPanel` component definition at the bottom of the file (or import it):

```tsx
import { MemoryDialog, type MemoryFormValues } from "@/components/memory-dialog";

function NotesPanel({ strategyId }: { strategyId: string }) {
  const [memories, setMemories] = useState<any[]>([]);
  const [editing, setEditing] = useState<Partial<MemoryFormValues> | null>(null);
  const [strategies, setStrategies] = useState<Array<{ id: string; name: string }>>([]);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/memories?strategyId=${strategyId}`);
    setMemories(await res.json());
  }, [strategyId]);

  useEffect(() => {
    refresh();
    fetch("/api/strategies").then((r) => r.json()).then(setStrategies);
  }, [refresh]);

  return (
    <div className="space-y-3">
      <Button onClick={() => setEditing({ strategyId })}>
        <Plus size={14} /> 新建笔记
      </Button>
      {memories.length === 0 && (
        <p className="text-sm text-muted-foreground py-4">该策略还没有笔记。</p>
      )}
      <div className="grid gap-2">
        {memories.map((m) => (
          <Card key={m.id} className="cursor-pointer hover:shadow" onClick={() => setEditing(m)}>
            <CardContent className="py-3">
              <div className="flex items-center gap-2">
                {m.pinned && <span title="置顶">📌</span>}
                <span className="font-medium">{m.title}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {new Date(m.updatedAt).toLocaleDateString()}
                </span>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{m.content}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {editing !== null && (
        <MemoryDialog
          open
          initial={editing}
          strategies={strategies}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`
- Visit `/strategies/<some-id>`, click 笔记 tab
- Click "新建笔记" — strategyId should be pre-selected
- Save, see the entry, edit it, delete it

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/strategies/\[id\]/page.tsx
git commit -m "feat(web): notes tab on strategy detail page"
```

---

## Phase D — LLM Integration

### Task D1: `loadRelevantMemories` worker module

**Files:**
- Create: `apps/worker/src/monitoring/load-memories.ts`
- Create: `apps/worker/src/monitoring/__tests__/load-memories.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/worker/src/monitoring/__tests__/load-memories.test.ts
import { describe, it, expect } from "vitest";
import { mergeAndCapMemories, type RawMemory } from "../load-memories.js";

const NOW = new Date("2026-06-05T00:00:00Z").getTime();

function mk(over: Partial<RawMemory> = {}): RawMemory {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: over.title ?? "T",
    content: over.content ?? "C",
    kind: over.kind ?? "note",
    symbol: over.symbol ?? null,
    pinned: over.pinned ?? false,
    updatedAt: over.updatedAt ?? new Date(NOW),
  };
}

describe("mergeAndCapMemories", () => {
  it("dedupes by id across sources", () => {
    const a = mk({ id: "x", title: "shared" });
    const b = mk({ id: "x", title: "shared" });
    const result = mergeAndCapMemories([a], [b], []);
    expect(result.length).toBe(1);
  });

  it("orders pinned first then by updatedAt desc", () => {
    const old = mk({ id: "1", pinned: false, updatedAt: new Date(NOW - 86400000) });
    const fresh = mk({ id: "2", pinned: false, updatedAt: new Date(NOW) });
    const pinned = mk({ id: "3", pinned: true, updatedAt: new Date(NOW - 200000000) });
    const result = mergeAndCapMemories([old, fresh, pinned], [], []);
    expect(result.map((m) => m.id)).toEqual(["3", "2", "1"]);
  });

  it("caps to 8 entries", () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      mk({ id: `m${i}`, updatedAt: new Date(NOW - i * 1000) })
    );
    const result = mergeAndCapMemories(many, [], []);
    expect(result.length).toBe(8);
  });

  it("truncates contentPreview to 200 chars", () => {
    const long = mk({ id: "x", content: "a".repeat(500) });
    const [r] = mergeAndCapMemories([long], [], []);
    expect(r.contentPreview.length).toBeLessThanOrEqual(200);
  });

  it("respects total 4000 char budget", () => {
    const big = Array.from({ length: 8 }, (_, i) =>
      mk({ id: `m${i}`, content: "a".repeat(800) })
    );
    const result = mergeAndCapMemories(big, [], []);
    const total = result.reduce((s, r) => s + r.contentPreview.length, 0);
    expect(total).toBeLessThanOrEqual(4000);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd apps/worker && npx vitest run src/monitoring/__tests__/load-memories.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement load-memories.ts**

```ts
// apps/worker/src/monitoring/load-memories.ts
import { sql, and, eq, or, gte, inArray, desc } from "drizzle-orm";
import { memories } from "@trader/db";
import type { drizzle } from "drizzle-orm/postgres-js";
import type * as schema from "@trader/db";

type DbType = ReturnType<typeof drizzle<typeof schema>>;

const MAX_TOTAL = 8;
const MAX_PER_CONTENT = 200;
const MAX_TOTAL_CHARS = 4000;
const RECENT_DAYS = 30;
const TOP_N_PER_BUCKET = 5;

export interface RawMemory {
  id: string;
  title: string;
  content: string;
  kind: "note" | "idea" | "lesson" | "context";
  symbol: string | null;
  pinned: boolean;
  updatedAt: Date;
}

export interface RelevantMemory {
  id: string;
  title: string;
  kind: string;
  symbol: string | null;
  pinned: boolean;
  contentPreview: string;
}

export function mergeAndCapMemories(
  pinnedRows: RawMemory[],
  strategyRows: RawMemory[],
  symbolRows: RawMemory[]
): RelevantMemory[] {
  const seen = new Map<string, RawMemory>();
  for (const m of [...pinnedRows, ...strategyRows, ...symbolRows]) {
    if (!seen.has(m.id)) seen.set(m.id, m);
  }
  const list = Array.from(seen.values()).sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

  const out: RelevantMemory[] = [];
  let totalChars = 0;
  for (const m of list) {
    if (out.length >= MAX_TOTAL) break;
    const preview = m.content.length > MAX_PER_CONTENT ? m.content.slice(0, MAX_PER_CONTENT) : m.content;
    if (totalChars + preview.length > MAX_TOTAL_CHARS) break;
    out.push({
      id: m.id,
      title: m.title,
      kind: m.kind,
      symbol: m.symbol,
      pinned: m.pinned,
      contentPreview: preview,
    });
    totalChars += preview.length;
  }
  return out;
}

export async function loadRelevantMemories(
  db: DbType,
  strategyId: string,
  symbols: string[]
): Promise<RelevantMemory[]> {
  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);

  try {
    const pinnedRows = await db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.pinned, true),
          or(eq(memories.strategyId, strategyId), sql`strategy_id IS NULL`)
        )
      )
      .orderBy(desc(memories.updatedAt));

    const strategyRows = await db
      .select()
      .from(memories)
      .where(and(eq(memories.strategyId, strategyId), gte(memories.updatedAt, since)))
      .orderBy(desc(memories.updatedAt))
      .limit(TOP_N_PER_BUCKET);

    let symbolRows: typeof strategyRows = [];
    if (symbols.length > 0) {
      symbolRows = await db
        .select()
        .from(memories)
        .where(and(inArray(memories.symbol, symbols), gte(memories.updatedAt, since)))
        .orderBy(desc(memories.updatedAt))
        .limit(TOP_N_PER_BUCKET);
    }

    return mergeAndCapMemories(
      pinnedRows as unknown as RawMemory[],
      strategyRows as unknown as RawMemory[],
      symbolRows as unknown as RawMemory[]
    );
  } catch (err) {
    console.warn("[monitoring] loadRelevantMemories failed, returning empty:", err);
    return [];
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/worker && npx vitest run src/monitoring/__tests__/load-memories.test.ts`
Expected: PASS — all 5 cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/monitoring/load-memories.ts apps/worker/src/monitoring/__tests__/load-memories.test.ts
git commit -m "feat(worker): loadRelevantMemories with pinned/strategy/symbol union + cap"
```

---

### Task D2: Modify `analyze.ts` to accept memories + extend test

**Files:**
- Modify: `apps/worker/src/monitoring/analyze.ts`
- Modify: `apps/worker/src/monitoring/__tests__/analyze.test.ts`

- [ ] **Step 1: Add new test cases first**

Append to `apps/worker/src/monitoring/__tests__/analyze.test.ts` (inside the existing `describe("analyzeStrategy", ...)`):

```ts
  it("includes memories section in prompt when memories provided", async () => {
    const client = mockClient(
      makeToolUseResponse({ analysis: "ok", has_action_items: false })
    );
    const analyze = createAnalyzer(client);
    await analyze(
      "S",
      "rules",
      [{ symbol: "QQQ", totalShares: 10, avgCost: 100, lots: [] }],
      { QQQ: { latest: 110, bars: [] } },
      [
        { id: "1", title: "看好 QQQ", kind: "idea", symbol: "QQQ", pinned: true, contentPreview: "H100 backlog" },
      ]
    );
    const prompt = (client.messages.create as any).mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("你之前留下的相关笔记");
    expect(prompt).toContain("看好 QQQ");
  });

  it("omits memories section when memories empty", async () => {
    const client = mockClient(
      makeToolUseResponse({ analysis: "ok", has_action_items: false })
    );
    const analyze = createAnalyzer(client);
    await analyze(
      "S",
      "rules",
      [{ symbol: "QQQ", totalShares: 10, avgCost: 100, lots: [] }],
      { QQQ: { latest: 110, bars: [] } },
      []
    );
    const prompt = (client.messages.create as any).mock.calls[0][0].messages[0].content;
    expect(prompt).not.toContain("你之前留下的相关笔记");
  });

  it("works without the memories argument (back-compat)", async () => {
    const client = mockClient(
      makeToolUseResponse({ analysis: "ok", has_action_items: false })
    );
    const analyze = createAnalyzer(client);
    const result = await analyze(
      "S",
      "rules",
      [{ symbol: "QQQ", totalShares: 10, avgCost: 100, lots: [] }],
      { QQQ: { latest: 110, bars: [] } }
    );
    expect(result.analysis).toBe("ok");
  });
```

- [ ] **Step 2: Run, verify the new tests fail**

Run: `cd apps/worker && npx vitest run src/monitoring/__tests__/analyze.test.ts`
Expected: 3 new cases FAIL (signature doesn't accept memories yet).

- [ ] **Step 3: Modify analyze.ts**

In `apps/worker/src/monitoring/analyze.ts`:

a) At the top, import the memory type defined in Task D1:

```ts
import type { RelevantMemory } from "./load-memories.js";
```

b) Change the inner `analyzeStrategy` signature inside `createAnalyzer`:

```ts
return async function analyzeStrategy(
  strategyName: string,
  strategyContent: string,
  positions: PositionInfo[],
  prices: Record<string, { latest: number; bars: Array<{ date: string; close: number }> }>,
  memories: RelevantMemory[] = []
): Promise<AnalysisResult> {
```

c) Just before the existing `const positionSummary = ...`, add memories formatting:

```ts
  const memoriesBlock = memories.length === 0
    ? ""
    : `## 你之前留下的相关笔记\n\n${memories
        .map((m) => {
          const tags = [m.pinned ? "pinned" : null, m.kind, m.symbol].filter(Boolean).join(" · ");
          return `- [${tags}] ${m.title}：${m.contentPreview}`;
        })
        .join("\n")}\n\n`;
```

d) In the `messages` array, change the user content from:

```ts
content: `你是一位严格按规则行事的交易策略分析师。基于下方策略 + 持仓 + 行情，判断今天是否触发了策略规则，并产出**简短**的中文分析。

## 策略：${strategyName}
```

to:

```ts
content: `你是一位严格按规则行事的交易策略分析师。基于下方策略 + 持仓 + 行情，判断今天是否触发了策略规则，并产出**简短**的中文分析。

${memoriesBlock}## 策略：${strategyName}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/worker && npx vitest run src/monitoring/__tests__/analyze.test.ts`
Expected: PASS — all existing + 3 new cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/monitoring/analyze.ts apps/worker/src/monitoring/__tests__/analyze.test.ts
git commit -m "feat(worker): analyze.ts accepts memories param and injects into prompt"
```

---

### Task D3: Wire `job.ts` → `loadRelevantMemories` → `analyze`

**Files:**
- Modify: `apps/worker/src/monitoring/job.ts`

- [ ] **Step 1: Add import**

At the top of `apps/worker/src/monitoring/job.ts`, alongside the analyze import, add:

```ts
import { loadRelevantMemories } from "./load-memories.js";
```

- [ ] **Step 2: Call it inside `processStrategy` before analyze**

Find the analyze call (around line 233):

```ts
() => analyze(strategy.name, strategy.content, positionInfos, prices),
```

Replace with:

```ts
async () => {
  const symbols = strategy.positions.map((p) => p.symbol);
  const relevantMemories = await loadRelevantMemories(db, strategy.id, symbols);
  return analyze(strategy.name, strategy.content, positionInfos, prices, relevantMemories);
},
```

- [ ] **Step 3: Type-check**

Run: `cd apps/worker && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run worker tests to make sure nothing else broke**

Run: `cd apps/worker && npm test`
Expected: all green.

- [ ] **Step 5: Manual smoke test**

In a dev shell with `.env` loaded:
- Insert a test memory via the UI or direct SQL: `INSERT INTO memories (title, content, kind, pinned) VALUES ('test', 'test content', 'note', true);`
- Trigger monitoring: `npx tsx scripts/trigger-job.ts daily-monitoring`
- Check the worker log; verify no warnings about loadRelevantMemories failing
- Inspect the saved `monitoring_runs.analysis` to confirm the prompt context flowed through (check via SQL or the strategy detail page)

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/monitoring/job.ts
git commit -m "feat(worker): wire memories into monitoring pipeline"
```

---

## Phase E — Insights Backend

### Task E1: `insights.ts` pure function + tests

**Files:**
- Create: `apps/web/lib/insights.ts`
- Create: `apps/web/lib/__tests__/insights.test.ts`

- [ ] **Step 1: Write the failing test (fixtures + 5 cases)**

```ts
// apps/web/lib/__tests__/insights.test.ts
import { describe, it, expect } from "vitest";
import { computeInsights, type LotInput, type SnapshotInput } from "../insights";

function buy(positionId: string, symbol: string, date: string, price: number, shares: number, refPrice?: number): LotInput {
  return { id: `b-${date}-${symbol}`, positionId, symbol, type: "BUY", lotDate: date, costPrice: price, shares, referencePrice: refPrice ?? null };
}
function sell(positionId: string, symbol: string, date: string, price: number, shares: number): LotInput {
  return { id: `s-${date}-${symbol}`, positionId, symbol, type: "SELL", lotDate: date, costPrice: price, shares, referencePrice: null };
}
function snap(symbol: string, date: string, close: number): SnapshotInput {
  return { symbol, date, close };
}

describe("computeInsights", () => {
  it("returns empty result when closedTrades < 5", () => {
    const lots: LotInput[] = [buy("p1", "AAA", "2026-01-01", 10, 100), sell("p1", "AAA", "2026-01-10", 12, 100)];
    const r = computeInsights(lots, []);
    expect(r).toEqual({ empty: true, reason: "insufficient_data" });
  });

  it("computes basic financials with 60% win rate, 2:1 PL ratio", () => {
    // 5 closed trades: 3 winners (+10 each), 2 losers (-5 each)
    const lots: LotInput[] = [];
    for (let i = 0; i < 3; i++) {
      lots.push(buy(`p${i}`, "W", `2026-01-${String(i + 1).padStart(2, "0")}`, 100, 1));
      lots.push(sell(`p${i}`, "W", `2026-01-${String(i + 6).padStart(2, "0")}`, 110, 1));
    }
    for (let i = 0; i < 2; i++) {
      lots.push(buy(`pL${i}`, "L", `2026-02-${String(i + 1).padStart(2, "0")}`, 100, 1));
      lots.push(sell(`pL${i}`, "L", `2026-02-${String(i + 6).padStart(2, "0")}`, 95, 1));
    }
    const r = computeInsights(lots, []);
    if ("empty" in r) throw new Error("expected non-empty");
    expect(r.basic.closedTrades).toBe(5);
    expect(r.basic.winRate).toBeCloseTo(0.6, 2);
    expect(r.basic.profitLossRatio).toBeCloseTo(2.0, 2);
    expect(r.basic.totalRealizedPnl).toBe(20);
  });

  it("flags severe disposition effect when winners held 5d, losers held 60d", () => {
    const lots: LotInput[] = [];
    for (let i = 0; i < 3; i++) {
      lots.push(buy(`p${i}`, "W", "2026-01-01", 100, 1));
      lots.push(sell(`p${i}`, "W", "2026-01-06", 110, 1));
    }
    for (let i = 0; i < 3; i++) {
      lots.push(buy(`pL${i}`, "L", "2026-02-01", 100, 1));
      lots.push(sell(`pL${i}`, "L", "2026-04-02", 95, 1));
    }
    const r = computeInsights(lots, []);
    if ("empty" in r) throw new Error("expected non-empty");
    expect(r.disposition.flag).toBe("severe");
    expect(r.disposition.score).toBeGreaterThan(0.6);
  });

  it("flags severe anchoring when BUY price is 20% above 30d high", () => {
    const symbol = "X";
    const lots: LotInput[] = [];
    const snaps: SnapshotInput[] = [];
    for (let d = 1; d <= 31; d++) {
      snaps.push(snap(symbol, `2026-01-${String(d).padStart(2, "0")}`, 100));
    }
    // 5 BUY lots all at 130 (30% above 30d high of 100)
    for (let i = 0; i < 5; i++) {
      lots.push(buy(`p${i}`, symbol, "2026-02-01", 130, 1));
      lots.push(sell(`p${i}`, symbol, "2026-02-05", 131, 1));
    }
    snaps.push(snap(symbol, "2026-02-01", 130));
    const r = computeInsights(lots, snaps);
    if ("empty" in r) throw new Error("expected non-empty");
    expect(r.anchoring.flag).toBe("severe");
    expect(r.anchoring.avgChaseHighPct).toBeGreaterThan(15);
  });

  it("flags severe overtrading: > 10 trades/week + flips ≥ 3", () => {
    const lots: LotInput[] = [];
    // 12 trades in one week = avg ~12/week (far above 10)
    for (let i = 0; i < 6; i++) {
      lots.push(buy(`p${i}`, "AAA", `2026-01-${String(i + 1).padStart(2, "0")}`, 100, 1));
      lots.push(sell(`p${i}`, "AAA", `2026-01-${String(i + 2).padStart(2, "0")}`, 101, 1));
    }
    const r = computeInsights(lots, []);
    if ("empty" in r) throw new Error("expected non-empty");
    expect(r.overtrading.flag).toBe("severe");
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd apps/web && npx vitest run lib/__tests__/insights.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `insights.ts`**

```ts
// apps/web/lib/insights.ts
export interface LotInput {
  id: string;
  positionId: string;
  symbol: string;
  type: "BUY" | "SELL";
  lotDate: string;          // ISO date
  costPrice: number;
  shares: number;
  referencePrice: number | null;  // positions.referencePrice at the time the lot was added (best-effort)
}

export interface SnapshotInput {
  symbol: string;
  date: string;             // ISO date
  close: number;
}

export interface InsightsReport {
  basic: {
    closedTrades: number;
    winRate: number;
    avgHoldDays: number;
    profitLossRatio: number;
    totalRealizedPnl: number;
    maxDrawdown: number;
  };
  disposition: {
    avgHoldDaysWinners: number;
    avgHoldDaysLosers: number;
    score: number;
    flag: "none" | "mild" | "severe";
  };
  anchoring: {
    avgChaseHighPct: number;
    chaseRate: number;
    avgVsRefPct: number;
    flag: "none" | "mild" | "severe";
  };
  overtrading: {
    avgTradesPerWeek: number;
    flipsWithin3d: number;
    flag: "none" | "mild" | "severe";
  };
}

export type ComputeResult = InsightsReport | { empty: true; reason: "insufficient_data" };

const MIN_CLOSED_TRADES = 5;
const ANCHOR_LOOKBACK_DAYS = 30;

const DISPOSITION_MILD = 0.3;
const DISPOSITION_SEVERE = 0.6;
const ANCHOR_MILD_PCT = 5;
const ANCHOR_SEVERE_PCT = 15;
const OVERTRADE_MILD_WEEKLY = 5;
const OVERTRADE_SEVERE_WEEKLY = 10;
const OVERTRADE_FLIPS_SEVERE = 3;

function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.max(0, Math.round((db - da) / 86_400_000));
}

interface ClosedTrade {
  symbol: string;
  buyDate: string;
  sellDate: string;
  buyPrice: number;
  sellPrice: number;
  shares: number;
  realized: number;
  holdDays: number;
}

// Pair BUY/SELL within the same positionId via FIFO; output one ClosedTrade per matched share unit.
function pairTrades(lots: LotInput[]): ClosedTrade[] {
  const byPos = new Map<string, LotInput[]>();
  for (const l of lots) {
    if (!byPos.has(l.positionId)) byPos.set(l.positionId, []);
    byPos.get(l.positionId)!.push(l);
  }

  const closed: ClosedTrade[] = [];
  for (const list of byPos.values()) {
    const sorted = [...list].sort((a, b) => a.lotDate.localeCompare(b.lotDate));
    const buys: Array<LotInput & { remaining: number }> = [];
    for (const lot of sorted) {
      if (lot.type === "BUY") {
        buys.push({ ...lot, remaining: lot.shares });
      } else {
        let remainingSell = lot.shares;
        while (remainingSell > 0 && buys.length > 0 && buys[0].remaining > 0) {
          const head = buys[0];
          const matched = Math.min(head.remaining, remainingSell);
          closed.push({
            symbol: lot.symbol,
            buyDate: head.lotDate,
            sellDate: lot.lotDate,
            buyPrice: head.costPrice,
            sellPrice: lot.costPrice,
            shares: matched,
            realized: (lot.costPrice - head.costPrice) * matched,
            holdDays: daysBetween(head.lotDate, lot.lotDate),
          });
          head.remaining -= matched;
          remainingSell -= matched;
          if (head.remaining === 0) buys.shift();
        }
      }
    }
  }
  return closed;
}

function maxDrawdown(closed: ClosedTrade[]): number {
  if (closed.length === 0) return 0;
  const sorted = [...closed].sort((a, b) => a.sellDate.localeCompare(b.sellDate));
  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of sorted) {
    cum += t.realized;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

function computeAnchoring(buyLots: LotInput[], snapshots: SnapshotInput[]) {
  if (buyLots.length === 0) {
    return { avgChaseHighPct: 0, chaseRate: 0, avgVsRefPct: 0 };
  }
  const bySymbol = new Map<string, SnapshotInput[]>();
  for (const s of snapshots) {
    if (!bySymbol.has(s.symbol)) bySymbol.set(s.symbol, []);
    bySymbol.get(s.symbol)!.push(s);
  }
  for (const arr of bySymbol.values()) arr.sort((a, b) => a.date.localeCompare(b.date));

  let chaseHighSum = 0;
  let chaseHighN = 0;
  let chaseAboveMaCount = 0;
  let chaseAboveMaTotal = 0;
  let vsRefSum = 0;
  let vsRefN = 0;

  for (const lot of buyLots) {
    const arr = bySymbol.get(lot.symbol) ?? [];
    const cutoff = new Date(lot.lotDate).getTime();
    const lookbackStart = cutoff - ANCHOR_LOOKBACK_DAYS * 86_400_000;
    const window = arr.filter((s) => {
      const t = new Date(s.date).getTime();
      return t >= lookbackStart && t < cutoff;
    });
    if (window.length > 0) {
      const high = Math.max(...window.map((s) => s.close));
      const ma = window.reduce((a, s) => a + s.close, 0) / window.length;
      chaseHighSum += ((lot.costPrice - high) / high) * 100;
      chaseHighN += 1;
      chaseAboveMaTotal += 1;
      if (lot.costPrice > ma) chaseAboveMaCount += 1;
    }
    if (lot.referencePrice && lot.referencePrice > 0) {
      vsRefSum += ((lot.costPrice - lot.referencePrice) / lot.referencePrice) * 100;
      vsRefN += 1;
    }
  }

  return {
    avgChaseHighPct: chaseHighN === 0 ? 0 : chaseHighSum / chaseHighN,
    chaseRate: chaseAboveMaTotal === 0 ? 0 : chaseAboveMaCount / chaseAboveMaTotal,
    avgVsRefPct: vsRefN === 0 ? 0 : vsRefSum / vsRefN,
  };
}

function flagFromThresholds(value: number, mild: number, severe: number): "none" | "mild" | "severe" {
  if (value > severe) return "severe";
  if (value > mild) return "mild";
  return "none";
}

function flipsWithin3Days(lots: LotInput[]): number {
  // For each symbol, sort by date and count cases where a SELL is followed within 3 days by a new BUY of the same symbol
  const bySym = new Map<string, LotInput[]>();
  for (const l of lots) {
    if (!bySym.has(l.symbol)) bySym.set(l.symbol, []);
    bySym.get(l.symbol)!.push(l);
  }
  let flips = 0;
  for (const arr of bySym.values()) {
    const sorted = [...arr].sort((a, b) => a.lotDate.localeCompare(b.lotDate));
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].type === "SELL" && sorted[i + 1].type === "BUY") {
        if (daysBetween(sorted[i].lotDate, sorted[i + 1].lotDate) <= 3) flips += 1;
      }
    }
  }
  return flips;
}

export function computeInsights(lots: LotInput[], snapshots: SnapshotInput[]): ComputeResult {
  const closed = pairTrades(lots);

  if (closed.length < MIN_CLOSED_TRADES) {
    return { empty: true, reason: "insufficient_data" };
  }

  const winners = closed.filter((t) => t.realized > 0);
  const losers = closed.filter((t) => t.realized < 0);

  const winRate = winners.length / closed.length;
  const avgHoldDays = closed.reduce((s, t) => s + t.holdDays, 0) / closed.length;
  const avgWinPnl = winners.length === 0 ? 0 : winners.reduce((s, t) => s + t.realized, 0) / winners.length;
  const avgLossPnl = losers.length === 0 ? 0 : losers.reduce((s, t) => s + Math.abs(t.realized), 0) / losers.length;
  const profitLossRatio = avgLossPnl === 0 ? 0 : avgWinPnl / avgLossPnl;
  const totalRealizedPnl = closed.reduce((s, t) => s + t.realized, 0);
  const maxDd = maxDrawdown(closed);

  const avgWinDays = winners.length === 0 ? 0 : winners.reduce((s, t) => s + t.holdDays, 0) / winners.length;
  const avgLossDays = losers.length === 0 ? 0 : losers.reduce((s, t) => s + t.holdDays, 0) / losers.length;
  const dispositionScore = avgLossDays === 0 ? 0 : (avgLossDays - avgWinDays) / avgLossDays;
  const dispositionFlag = flagFromThresholds(dispositionScore, DISPOSITION_MILD, DISPOSITION_SEVERE);

  const buys = lots.filter((l) => l.type === "BUY");
  const anchor = computeAnchoring(buys, snapshots);
  const anchoringFlag = flagFromThresholds(anchor.avgChaseHighPct, ANCHOR_MILD_PCT, ANCHOR_SEVERE_PCT);

  const dates = lots.map((l) => new Date(l.lotDate).getTime()).sort((a, b) => a - b);
  const span = dates.length === 0 ? 0 : (dates[dates.length - 1] - dates[0]) / (7 * 86_400_000);
  const avgTradesPerWeek = span === 0 ? lots.length : lots.length / Math.max(1, span);
  const flips = flipsWithin3Days(lots);
  const overtradeFlag: "none" | "mild" | "severe" =
    flips >= OVERTRADE_FLIPS_SEVERE || avgTradesPerWeek > OVERTRADE_SEVERE_WEEKLY
      ? "severe"
      : flips >= 1 || avgTradesPerWeek > OVERTRADE_MILD_WEEKLY
      ? "mild"
      : "none";

  return {
    basic: {
      closedTrades: closed.length,
      winRate,
      avgHoldDays,
      profitLossRatio,
      totalRealizedPnl,
      maxDrawdown: maxDd,
    },
    disposition: {
      avgHoldDaysWinners: avgWinDays,
      avgHoldDaysLosers: avgLossDays,
      score: dispositionScore,
      flag: dispositionFlag,
    },
    anchoring: { ...anchor, flag: anchoringFlag },
    overtrading: { avgTradesPerWeek, flipsWithin3d: flips, flag: overtradeFlag },
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/web && npx vitest run lib/__tests__/insights.test.ts`
Expected: PASS — all 5 cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/insights.ts apps/web/lib/__tests__/insights.test.ts
git commit -m "feat(web): insights pure function with 4 indicator categories"
```

---

### Task E2: `/api/insights` route

**Files:**
- Create: `apps/web/app/api/insights/route.ts`
- Create: `apps/web/app/api/insights/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/api/insights/__tests__/route.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecuteLots, mockExecuteSnaps } = vi.hoisted(() => ({
  mockExecuteLots: vi.fn(),
  mockExecuteSnaps: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    execute: vi.fn().mockImplementation((q) => {
      const text = String(q).toLowerCase();
      if (text.includes("position_lots")) return mockExecuteLots();
      return mockExecuteSnaps();
    }),
  },
}));

import { GET } from "../route";

describe("GET /api/insights", () => {
  beforeEach(() => {
    mockExecuteLots.mockReset();
    mockExecuteSnaps.mockReset();
  });

  it("returns empty result when fewer than 5 closed trades", async () => {
    mockExecuteLots.mockResolvedValueOnce([]);
    mockExecuteSnaps.mockResolvedValueOnce([]);
    const res = await GET(new Request("http://localhost/api/insights"));
    const data = await res.json();
    expect(data.empty).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fails**

Run: `cd apps/web && npx vitest run app/api/insights/__tests__/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

```ts
// apps/web/app/api/insights/route.ts
export const dynamic = "force-dynamic";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { computeInsights, type LotInput, type SnapshotInput } from "@/lib/insights";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const strategyId = url.searchParams.get("strategyId") ?? null;

  // p.reference_price is the *current* value, not the value at lot time.
  // We don't snapshot historical ref prices; avgVsRefPct is therefore best-effort.
  const lotsRaw = strategyId
    ? await db.execute(sql`
        SELECT pl.id, pl.position_id AS "positionId", p.symbol, pl.type,
               pl.lot_date AS "lotDate", pl.cost_price AS "costPrice", pl.shares,
               p.reference_price AS "referencePrice"
        FROM position_lots pl
        JOIN positions p ON p.id = pl.position_id
        WHERE p.strategy_id = ${strategyId}
        ORDER BY pl.lot_date ASC
      `)
    : await db.execute(sql`
        SELECT pl.id, pl.position_id AS "positionId", p.symbol, pl.type,
               pl.lot_date AS "lotDate", pl.cost_price AS "costPrice", pl.shares,
               p.reference_price AS "referencePrice"
        FROM position_lots pl
        JOIN positions p ON p.id = pl.position_id
        ORDER BY pl.lot_date ASC
      `);

  const lots: LotInput[] = (lotsRaw as any[]).map((r) => ({
    id: r.id,
    positionId: r.positionId,
    symbol: r.symbol,
    type: r.type,
    lotDate: r.lotDate,
    costPrice: parseFloat(r.costPrice),
    shares: parseFloat(r.shares),
    referencePrice: r.referencePrice ? parseFloat(r.referencePrice) : null,
  }));

  const symbols = Array.from(new Set(lots.map((l) => l.symbol)));
  const snapsRaw = symbols.length === 0
    ? []
    : await db.execute(sql`
        SELECT symbol, date::text, close
        FROM price_snapshots
        WHERE symbol IN (${sql.join(symbols.map((s) => sql`${s}`), sql`, `)})
        ORDER BY date ASC
      `);

  const snaps: SnapshotInput[] = (snapsRaw as any[]).map((r) => ({
    symbol: r.symbol,
    date: r.date,
    close: parseFloat(r.close),
  }));

  const t0 = Date.now();
  const result = computeInsights(lots, snaps);
  const ms = Date.now() - t0;
  if (ms > 500) console.warn(`[insights] computation took ${ms}ms`);

  return Response.json(result);
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/web && npx vitest run app/api/insights/__tests__/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/insights
git commit -m "feat(web): GET /api/insights compute on-demand"
```

---

## Phase F — Insights UI

### Task F1: `/insights` page with global + per-strategy tabs

**Files:**
- Create: `apps/web/app/insights/page.tsx`

- [ ] **Step 1: Implement the page**

```tsx
// apps/web/app/insights/page.tsx
"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Flag = "none" | "mild" | "severe";

interface Report {
  basic: {
    closedTrades: number;
    winRate: number;
    avgHoldDays: number;
    profitLossRatio: number;
    totalRealizedPnl: number;
    maxDrawdown: number;
  };
  disposition: { avgHoldDaysWinners: number; avgHoldDaysLosers: number; score: number; flag: Flag };
  anchoring: { avgChaseHighPct: number; chaseRate: number; avgVsRefPct: number; flag: Flag };
  overtrading: { avgTradesPerWeek: number; flipsWithin3d: number; flag: Flag };
}

type ApiResult = Report | { empty: true; reason: string };

interface Strategy { id: string; name: string }

const flagColor: Record<Flag, string> = {
  none: "bg-muted text-muted-foreground",
  mild: "bg-yellow-100 text-yellow-900 dark:bg-yellow-900/40 dark:text-yellow-200",
  severe: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
};

const flagLabel: Record<Flag, string> = { none: "正常", mild: "轻度", severe: "严重" };

function FlagBadge({ flag }: { flag: Flag }) {
  return <Badge className={cn("text-[10px]", flagColor[flag])}>{flagLabel[flag]}</Badge>;
}

function pct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

function ReportView({ data }: { data: ApiResult | null }) {
  if (data === null) return <p className="text-sm text-muted-foreground py-8 text-center">加载中…</p>;
  if ("empty" in data) {
    return <p className="text-sm text-muted-foreground py-8 text-center">交易数据不足，需至少 5 笔已平仓交易</p>;
  }

  const { basic, disposition, anchoring, overtrading } = data;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">基础财务</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex justify-between"><span>已平仓交易</span><span>{basic.closedTrades}</span></div>
          <div className="flex justify-between"><span>胜率</span><span>{pct(basic.winRate)}</span></div>
          <div className="flex justify-between"><span>盈亏比</span><span>{basic.profitLossRatio.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>平均持仓天数</span><span>{basic.avgHoldDays.toFixed(1)}</span></div>
          <div className="flex justify-between"><span>已实现盈亏</span><span>{basic.totalRealizedPnl.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>最大回撤</span><span>{basic.maxDrawdown.toFixed(2)}</span></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            处置效应 <FlagBadge flag={disposition.flag} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p className="text-muted-foreground text-xs">
            赢家持仓 {disposition.avgHoldDaysWinners.toFixed(1)} 天 vs 输家 {disposition.avgHoldDaysLosers.toFixed(1)} 天
          </p>
          <div className="flex justify-between"><span>得分</span><span>{disposition.score.toFixed(2)}</span></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            锚定 / 追高 <FlagBadge flag={anchoring.flag} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex justify-between"><span>BUY 价 vs 30日高点偏离</span><span>{anchoring.avgChaseHighPct.toFixed(2)}%</span></div>
          <div className="flex justify-between"><span>BUY > 30日均线占比</span><span>{pct(anchoring.chaseRate)}</span></div>
          <div className="flex justify-between"><span>BUY 价 vs 参考价偏离</span><span>{anchoring.avgVsRefPct.toFixed(2)}%</span></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            过度交易 <FlagBadge flag={overtrading.flag} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex justify-between"><span>周均交易笔数</span><span>{overtrading.avgTradesPerWeek.toFixed(1)}</span></div>
          <div className="flex justify-between"><span>3 日内反复开平次数</span><span>{overtrading.flipsWithin3d}</span></div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function InsightsPage() {
  const [tab, setTab] = useState<"global" | "byStrategy">("global");
  const [globalData, setGlobalData] = useState<ApiResult | null>(null);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [stratData, setStratData] = useState<ApiResult | null>(null);

  useEffect(() => {
    fetch("/api/insights").then((r) => r.json()).then(setGlobalData);
    fetch("/api/strategies").then((r) => r.json()).then((arr) => {
      setStrategies(arr);
      if (arr.length > 0) setPickedId(arr[0].id);
    });
  }, []);

  useEffect(() => {
    if (!pickedId || tab !== "byStrategy") return;
    setStratData(null);
    fetch(`/api/insights?strategyId=${pickedId}`).then((r) => r.json()).then(setStratData);
  }, [pickedId, tab]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2 border-b">
        <button
          onClick={() => setTab("global")}
          className={cn("px-3 py-2 text-sm border-b-2", tab === "global" ? "border-primary" : "border-transparent")}
        >
          全局
        </button>
        <button
          onClick={() => setTab("byStrategy")}
          className={cn("px-3 py-2 text-sm border-b-2", tab === "byStrategy" ? "border-primary" : "border-transparent")}
        >
          按策略
        </button>
      </div>

      {tab === "global" && <ReportView data={globalData} />}

      {tab === "byStrategy" && (
        <div className="grid md:grid-cols-[200px_1fr] gap-4">
          <div className="space-y-1">
            {strategies.map((s) => (
              <button
                key={s.id}
                onClick={() => setPickedId(s.id)}
                className={cn(
                  "block w-full text-left px-3 py-2 rounded text-sm",
                  pickedId === s.id ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                )}
              >
                {s.name}
              </button>
            ))}
            {strategies.length === 0 && (
              <p className="text-xs text-muted-foreground p-2">暂无策略</p>
            )}
          </div>
          <ReportView data={stratData} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`
- Visit `/insights`
- Verify global tab shows 4 cards (or empty state if you don't have ≥ 5 closed trades)
- Switch to 按策略 tab; click each strategy in the left list, verify cards refresh
- Verify flag badges have appropriate colors

- [ ] **Step 4: Run all web tests as final regression check**

Run: `cd apps/web && npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/insights
git commit -m "feat(web): /insights page with global + per-strategy tabs"
```

---

## Final verification

- [ ] **Step 1: Run all tests across the workspace**

Run: `npm test`
Expected: all suites green.

- [ ] **Step 2: Type-check both apps**

Run: `cd apps/web && npx tsc --noEmit && cd ../worker && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Smoke-test the full integration**

Run: `npm run dev`
- Create a memory tagged to a real strategy with `pinned: true`
- Manually trigger monitoring: `npx tsx scripts/trigger-job.ts daily-monitoring`
- Open the strategy detail page, find today's monitoring run, read the `analysis`. The model should reference (or at least incorporate) the pinned memory's content.
- Visit `/insights` and confirm the four cards render (or empty state shows correctly).
