# Decimal Shares Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change `position_lots.shares` from integer to `numeric(15,4)` so fractional shares can be stored and displayed.

**Architecture:** Three-layer change — DB schema + migration, backend API fix, frontend form/display fix. The key ripple effect is that drizzle returns `numeric` columns as JS strings, so every consumer of `lot.shares` must call `parseFloat`.

**Tech Stack:** PostgreSQL, Drizzle ORM, Next.js 15, TypeScript

---

## File Map

| File | Change |
|------|--------|
| `packages/db/src/schema.ts` | `integer` → `numeric(15,4)` for `shares` |
| `packages/db/src/schema.test.ts` | Add assertion that `shares` is numeric type |
| `apps/web/app/api/positions/summary/route.ts` | Add `parseFloat` around `l.shares` in both reduce calls |
| `apps/web/app/strategies/[id]/page.tsx` | `Lot.shares: string`, `parseInt`→`parseFloat`, `step="0.0001"`, `formatShares` helper, update all `lot.shares` display usages |

---

### Task 1: Update DB schema and add test

**Files:**
- Modify: `packages/db/src/schema.ts:52`
- Modify: `packages/db/src/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/db/src/schema.test.ts` inside the existing `describe` block:

```ts
it("positionLots.shares is numeric (supports decimals)", () => {
  // drizzle numeric columns have dataType "custom" and columnType "PgNumeric"
  const col = (positionLots.shares as unknown as { columnType: string });
  expect(col.columnType).toBe("PgNumeric");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/didi/code/trader && npm run test -w packages/db
```

Expected: FAIL — `columnType` is `"PgInteger"`, not `"PgNumeric"`

- [ ] **Step 3: Update schema.ts**

In `packages/db/src/schema.ts`, change line 52:

```ts
// before
shares: integer("shares").notNull(),

// after
shares: numeric("shares", { precision: 15, scale: 4 }).notNull(),
```

Also ensure `numeric` is already in the import list at line 1 (it is — `costPrice` uses it).

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/didi/code/trader && npm run test -w packages/db
```

Expected: all tests PASS

- [ ] **Step 5: Rebuild db package**

```bash
cd /Users/didi/code/trader && npm run build -w packages/db
```

Expected: exits 0 with no errors

- [ ] **Step 6: Apply migration via drizzle push**

This project uses `drizzle-kit push`. Run it with your local `.env`:

```bash
cd /Users/didi/code/trader && npm run db:push -w packages/db
```

Expected output includes: `shares numeric(15,4)` or similar confirmation. PostgreSQL safely casts existing integer values to numeric.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/schema.test.ts
git commit -m "feat: change position_lots.shares to numeric(15,4)"
```

---

### Task 2: Fix summary API route

**Files:**
- Modify: `apps/web/app/api/positions/summary/route.ts:31-32`

After the schema change, `l.shares` is returned as a string by drizzle. The current code does arithmetic on it directly, which would silently produce NaN or string concatenation.

- [ ] **Step 1: Update both reduce calls**

In `apps/web/app/api/positions/summary/route.ts`, replace lines 31–32:

```ts
// before
const shares = positionLots.reduce((s, l) => s + l.shares, 0);
const cost = positionLots.reduce((s, l) => s + l.shares * parseFloat(l.costPrice), 0);

// after
const shares = positionLots.reduce((s, l) => s + parseFloat(l.shares), 0);
const cost = positionLots.reduce((s, l) => s + parseFloat(l.shares) * parseFloat(l.costPrice), 0);
```

> Note: After Task 1 rebuilds `packages/db`, drizzle infers `numeric` fields as `string`, so `l.shares` is `string` here. `parseFloat` handles it correctly.

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/api/positions/summary/route.ts
git commit -m "fix: parseFloat shares in summary route (numeric column returns string)"
```

---

### Task 3: Update frontend form and display

**Files:**
- Modify: `apps/web/app/strategies/[id]/page.tsx`

Changes needed:
1. `Lot` interface: `shares: number` → `shares: string`
2. Add `formatShares` helper
3. `parseInt(lotShares)` → `parseFloat(lotShares)` in `handleAddLot`
4. Add `step="0.0001"` to shares input
5. `calcAggregated`: `l.shares` → `parseFloat(l.shares)`
6. Display `{lot.shares}股` → `{formatShares(lot.shares)}股`
7. Display `{totalShares} 股` → `{formatShares(totalShares)}股`

- [ ] **Step 1: Update `Lot` interface (line 33)**

```ts
// before
interface Lot {
  id: string;
  shares: number;
  costPrice: string;
  lotDate: string;
  notes: string | null;
}

// after
interface Lot {
  id: string;
  shares: string;
  costPrice: string;
  lotDate: string;
  notes: string | null;
}
```

- [ ] **Step 2: Add `formatShares` helper after the interface declarations (around line 48, after the `type Tab` line)**

```ts
function formatShares(shares: string | number): string {
  const n = typeof shares === "string" ? parseFloat(shares) : shares;
  return String(n);
}
```

- [ ] **Step 3: Fix `handleAddLot` (line 122)**

```ts
// before
shares: parseInt(lotShares),

// after
shares: parseFloat(lotShares),
```

- [ ] **Step 4: Add `step="0.0001"` to shares input (line 577)**

```tsx
// before
<Input type="number" value={lotShares} onChange={(e) => setLotShares(e.target.value)} />

// after
<Input type="number" step="0.0001" value={lotShares} onChange={(e) => setLotShares(e.target.value)} />
```

- [ ] **Step 5: Fix `calcAggregated` (lines 285–286)**

```ts
// before
function calcAggregated(lots: Lot[]) {
  const totalShares = lots.reduce((s, l) => s + l.shares, 0);
  const totalCost = lots.reduce((s, l) => s + l.shares * parseFloat(l.costPrice), 0);
  const avgCost = totalShares > 0 ? totalCost / totalShares : 0;
  return { totalShares, avgCost };
}

// after
function calcAggregated(lots: Lot[]) {
  const totalShares = lots.reduce((s, l) => s + parseFloat(l.shares), 0);
  const totalCost = lots.reduce((s, l) => s + parseFloat(l.shares) * parseFloat(l.costPrice), 0);
  const avgCost = totalShares > 0 ? totalCost / totalShares : 0;
  return { totalShares, avgCost };
}
```

- [ ] **Step 6: Fix position summary display (line 612)**

```tsx
// before
<span className="text-sm text-muted-foreground">
  {totalShares} 股 @ ${avgCost.toFixed(2)}
</span>

// after
<span className="text-sm text-muted-foreground">
  {formatShares(totalShares)} 股 @ ${avgCost.toFixed(2)}
</span>
```

- [ ] **Step 7: Fix per-lot display (line 631)**

```tsx
// before
<span className="tabular-nums">{lot.shares}股</span>

// after
<span className="tabular-nums">{formatShares(lot.shares)}股</span>
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd /Users/didi/code/trader && npx tsc --noCheck -p apps/web/tsconfig.json
```

Expected: exits 0

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/strategies/\[id\]/page.tsx
git commit -m "feat: support decimal shares in position form and display"
```
