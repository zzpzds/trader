# AI Berkshire Port — Sub-project A: Skills Seed Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 new seed skills adapted from `~/code/ai-berkshire/skills/*.md` into `packages/db/seed/skills/`, plus introduce two new skill categories (`fundamental`, `process`) so the new skills have a meaningful home in the UI.

**Architecture:** Pure additive change — extend the `SKILL_CATEGORIES` const tuple in `apps/web/lib/skills-ui.ts`, write 8 new markdown files into `packages/db/seed/skills/` following the existing frontmatter convention (`name` / `description` / `category` + body), and add a regression test that validates every seed file's frontmatter + body length. No runtime code in `apps/worker` or `apps/web` changes behavior — once seeded, the `/skills/import` wizard auto-discovers the new files via the existing `getSeedManifest` pipeline.

**Tech Stack:** TypeScript 5.7, Vitest, Drizzle ORM (schema unchanged), Next.js 16 App Router (no API changes), `@trader/db` workspace package (seed dir lives here).

**Spec:** `docs/superpowers/specs/2026-06-30-ai-berkshire-port-A-skills-seed-expansion-design.md`

**Adaptation source:** `~/code/ai-berkshire/skills/<name>.md` for each skill.

## Global Constraints

- Each seed skill body MUST be ≤ 6000 characters (`SKILL_BODY_MAX` from `apps/web/lib/skills-ui.ts`).
- Each seed skill MUST start with a frontmatter block `---\nname: <kebab-case>\ndescription: <...>\ncategory: <one-of-allowed>\n---` parseable by `parseFrontmatter` in `packages/db/src/seed-helpers.ts`.
- `name` MUST be the kebab-case filename without extension and globally unique across `packages/db/seed/skills/`.
- `category` MUST be one of: `pattern | risk | valuation | behavioral | macro | other | fundamental | process` (last two added by Task 1).
- Adapted body MUST remove ai-berkshire's slash-command idioms — no `$ARGUMENTS`, no `Task` tool dispatch, no `python3 ~/ai-berkshire/...` calls, no "并行 Agent" sections.
- Adapted body MUST recast the use context from "input a company, run research report" to "the current strategy / position is already known, please apply this methodology to inspect it."
- Adapted body MUST preserve the methodology skeleton of the original — metric tables, scoring rubrics, exclusion rules, decision trees stay intact (compress examples / case studies if needed for the 6000 char cap, but don't drop rules).
- All files MUST be valid UTF-8 and use LF line endings.
- Commit messages follow the existing convention `docs:` for spec/plan, `feat(db):` for seed additions, `feat(web):` for `skills-ui.ts` changes.

---

## Phase 1 — Category Extension

### Task 1: Extend `SKILL_CATEGORIES` with `fundamental` + `process`

**Files:**
- Modify: `apps/web/lib/skills-ui.ts:8-25`
- Test: `apps/web/lib/__tests__/skills.test.ts` (verify existing tests still pass — no new test needed; types catch breakage)

**Interfaces:**
- Consumes: nothing
- Produces: `SkillCategory` union type now includes `"fundamental"` and `"process"`; `CATEGORY_LABELS["fundamental"]` returns `"基本面"`; `CATEGORY_LABELS["process"]` returns `"流程纪律"`. All downstream code (`getSeedManifest`, `validateSkillCategory`, `/skills` page grouping) automatically picks them up.

- [ ] **Step 1: Modify `SKILL_CATEGORIES` and `CATEGORY_LABELS`**

Replace lines 8-25 in `apps/web/lib/skills-ui.ts` with:

```ts
export const SKILL_CATEGORIES = [
  "pattern",
  "risk",
  "valuation",
  "behavioral",
  "macro",
  "fundamental",
  "process",
  "other",
] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<SkillCategory, string> = {
  pattern: "形态识别",
  risk: "风险管理",
  valuation: "估值方法",
  behavioral: "行为金融",
  macro: "宏观分析",
  fundamental: "基本面",
  process: "流程纪律",
  other: "其他",
};
```

Note: `other` stays last so it remains the visual "catch-all" group on the `/skills` page.

- [ ] **Step 2: Run the existing skills test suite to confirm no regression**

Run: `npm run test -w apps/web -- skills`
Expected: PASS — all existing tests in `apps/web/lib/__tests__/skills.test.ts` still pass. The added categories are accepted by `validateSkillCategory` (`VALID_CATEGORIES = new Set<string>(SKILL_CATEGORIES)`).

- [ ] **Step 3: Run TypeScript build on web app to catch any unhandled union case**

Run: `npm run build -w apps/web`
Expected: PASS. Any switch over `SkillCategory` would have errored on the missing cases — if build is green, no such switch exists.

Known pre-existing blocker: if build fails in `apps/web/lib/position-service.ts` with `Type error: Type 'number' is not assignable to type 'string | SQL<unknown> | Placeholder<string, any>'` around `.values({ positionId, type: "BUY", shares, costPrice, ... })`, record it as unrelated to this category change and continue. If build fails in `skills-ui.ts`, `/skills`, `/skills/import`, or seed parsing code, stop and fix before continuing.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/skills-ui.ts
git commit -m "feat(web): add fundamental + process skill categories"
```

---

## Phase 2 — Regression Test for Seed Manifest

### Task 2: Add seed-files validation test

**Files:**
- Create: `packages/db/src/seed-skills.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter` from `packages/db/src/seed-helpers.ts`; allowed category literals and `SKILL_BODY_MAX` value `6000` are inlined.
- Produces: A test that scans `packages/db/seed/skills/*.md` and asserts every file's frontmatter is valid, body length ≤ 6000, category in allowed set, and `name` matches the filename stem.

Note: `apps/web/lib/skills-ui.ts` lives outside `packages/db`, so we cannot import it from inside the db workspace. Inline the constants. The duplication risk is acceptable — both files are short and a future drift would be caught by either `validateSkillCategory` at runtime or this test.

Important sequencing: this first test must pass with the existing 5 seed files before the 8 ai-berkshire files exist. Adapted-file-specific assertions (exact 8 filenames, category mapping, source note, forbidden token scan) are added later in Task 11, after all 8 files have been created.

- [ ] **Step 1: Check if a `__tests__` dir already exists in packages/db/src**

Run: `ls packages/db/src/__tests__ 2>/dev/null || ls packages/db/src/*.test.ts`
Expected: `packages/db/src/schema.test.ts` exists; no `__tests__` dir. Place new test as a sibling: `packages/db/src/seed-skills.test.ts`.

- [ ] **Step 2: Write the failing test**

Create `packages/db/src/seed-skills.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "./seed-helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.join(__dirname, "..", "seed", "skills");

const ALLOWED_CATEGORIES = new Set([
  "pattern",
  "risk",
  "valuation",
  "behavioral",
  "macro",
  "fundamental",
  "process",
  "other",
]);

const BODY_MAX = 6000;

function readSeedFiles(): { fname: string; raw: string }[] {
  return readdirSync(SEED_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((fname) => ({
      fname,
      raw: readFileSync(path.join(SEED_DIR, fname), "utf8"),
    }));
}

describe("seed/skills/*.md", () => {
  const files = readSeedFiles();

  it("contains at least one seed file", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("$fname parses cleanly", ({ fname, raw }) => {
    const parsed = parseFrontmatter(raw);
    // name must match filename stem
    const stem = fname.replace(/\.md$/, "");
    expect(parsed.name).toBe(stem);
    // description required
    expect(parsed.description).toBeTruthy();
    expect((parsed.description ?? "").length).toBeGreaterThan(0);
    // category required + in allowed set
    expect(parsed.category).not.toBeNull();
    expect(ALLOWED_CATEGORIES.has(parsed.category as string)).toBe(true);
    // body length within cap
    expect(parsed.bodyMd.length).toBeLessThanOrEqual(BODY_MAX);
  });

  it("has globally unique names", () => {
    const names = files.map(({ raw }) => parseFrontmatter(raw).name);
    expect(new Set(names).size).toBe(names.length);
  });
});
```

- [ ] **Step 3: Run the test against the existing 5 seed files to verify it passes today**

Run: `npm run test -w packages/db -- seed-skills`
Expected: PASS — 5 existing files (`behavioral-finance`, `candlestick`, `reference-price-management`, `risk-checklist`, `valuation-basic`) all parse and pass every assertion. The `it.each` reports 5 ✓ entries plus the count + uniqueness checks.

If any existing file fails (unlikely), it indicates a pre-existing bug; stop and investigate before continuing.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/seed-skills.test.ts
git commit -m "test(db): add seed-skills frontmatter validation"
```

---

## Phase 3 — Adapt and Add 8 Skills

For each of the 8 tasks below, the workflow is:

1. Read the source: `~/code/ai-berkshire/skills/<name>.md`
2. Apply the **Adaptation Procedure** (defined once, applied uniformly):
   - Strip every line/block that uses `$ARGUMENTS`, `Task` tool dispatch, `python3` invocation, or describes "parallel Agent" choreography.
   - Replace the framing "对 $ARGUMENTS 执行 X 分析" with "在当前 strategy / position 上下文中，请按以下方法论检视当前标的".
   - Keep all metric tables, scoring rubrics, exclusion rules, decision trees verbatim where possible — compress examples and case studies only.
   - Replace any reference to external files (e.g., "把结果写到 reports/...") with inline output suggestions ("在 analysis 中按下面模板输出").
   - Add a short top note: `> 改写自 ai-berkshire/skills/<name>.md，保留方法论骨架，去除 slash command 与外部工具调用，适配为 trader 持仓监控上下文。`
   - Ensure body length ≤ 6000 chars. If overshot, trim explanation paragraphs first, then case studies; never trim rules.
3. Write the result to `packages/db/seed/skills/<name>.md` with the frontmatter shown in each task.
4. Run the seed-skills test to verify.
5. Commit.

Each task ends with the same verify + commit footer, abbreviated below as **"Verify & Commit"**:

```bash
npm run test -w packages/db -- seed-skills
# Expected: PASS — the new file now appears in the it.each list and passes all assertions
git add packages/db/seed/skills/<name>.md
git commit -m "feat(db): seed <name> skill from ai-berkshire"
```

If the test fails on the new file, the most likely causes are: (a) frontmatter not parseable (missing `---` markers or malformed `key: value`), (b) body > 6000 chars (compress more), (c) `name` field doesn't match filename stem, (d) category typo.

---

### Task 3: Add `quality-screen.md` (category: fundamental)

**Files:**
- Source (read-only): `~/code/ai-berkshire/skills/quality-screen.md`
- Create: `packages/db/seed/skills/quality-screen.md`

**Interfaces:**
- Consumes: ai-berkshire 7-条去劣指标 + 3-条豁免规则 framework.
- Produces: A skill the user can attach to any strategy. When loaded into the monitoring prompt, instructs the LLM to evaluate held / candidate symbols against the 7 hard rules.

- [ ] **Step 1: Read the source**

Run: `cat ~/code/ai-berkshire/skills/quality-screen.md`
Expected: prints the original markdown (~280 lines / approximately 8-10 KB).

- [ ] **Step 2: Apply the Adaptation Procedure**

Required frontmatter:

```yaml
---
name: quality-screen
description: 7 条去劣指标速查：用 ROE / FCF / 利息覆盖 / 毛利率 / 现金流质量 / 净利率 / 股本膨胀，排除非一流公司；附 3 条豁免规则。
category: fundamental
---
```

Must-keep sections (do NOT compress these):
- 「7 条去劣指标」表格（# / 指标 / 排除条件 / 衡量的是什么 — 共 7 行）
- 「3 条豁免规则」(豁免 A 战略投入期 / 豁免 B 主动低利润率 / 豁免 C 高周转薄利)
- 设计原则段（"不错杀任何一流好公司，但能排除确定的非一流公司"）

May compress: 行业模式 / 主题模式 / 市场模式 的多段说明（trader 用户单次评估的是当前持仓，不需要"扫描成分股"的指引）；案例公司列表（茅台、亚马逊、美团 各举一例足够）。

Top-of-body framing line (replace the original "对 $ARGUMENTS 执行..."):

```
在当前 strategy / position 上下文中，请用 7 条去劣指标排查持仓或候选标的，命中即输出风险提示；判定豁免时必须三条都满足。
```

- [ ] **Step 3: Verify & Commit**

(see footer template above)

---

### Task 4: Add `investment-checklist.md` (category: fundamental)

**Files:**
- Source: `~/code/ai-berkshire/skills/investment-checklist.md`
- Create: `packages/db/seed/skills/investment-checklist.md`

**Interfaces:**
- Consumes: ai-berkshire 巴菲特六关 framework (能力圈 / 经济特征 / 护城河 / 管理层 / 估值 / 风险).
- Produces: A skill that, when attached to a strategy, asks the LLM to run the 6-gate buy-confirmation checklist when a strategy's buy rule is on the verge of triggering.

- [ ] **Step 1: Read source**

Run: `cat ~/code/ai-berkshire/skills/investment-checklist.md`
Expected: ~250+ lines.

- [ ] **Step 2: Apply Adaptation Procedure**

Required frontmatter:

```yaml
---
name: investment-checklist
description: 巴菲特价值投资买入前六关 checklist：能力圈 / 经济特征 / 护城河 / 管理层 / 估值 / 风险；buy 信号触发前最终确认。
category: fundamental
---
```

Must-keep: 六关的每关「评分标准 ★1-5」表格 + 每关的「硬性否决」规则。

Must remove: 「第二步：并行数据收集」(Task 工具调度) 整段；`python3 ~/ai-berkshire/tools/financial_rigor.py verify-valuation` 命令；「输入格式：单个或多个公司」整段；「信息丰富度 A/B/C 评级」可保留（仍然实用），但删去 "AI 研究偏见预警" 的说教语气。

Each gate compressed to ≤ 600 chars (table + scoring + 硬性否决 only).

Top-of-body framing line:

```
当 strategy 的 buy 规则即将触发或刚触发时，请按下面六关逐项打分，任一关给 ★1 即标注「不通过，原因：…」并建议放弃本次买入。
```

- [ ] **Step 3: Verify & Commit**

---

### Task 5: Add `thesis-tracker.md` (category: process)

**Files:**
- Source: `~/code/ai-berkshire/skills/thesis-tracker.md`
- Create: `packages/db/seed/skills/thesis-tracker.md`

**Interfaces:**
- Consumes: ai-berkshire thesis 验伪 framework.
- Produces: A skill that, when attached to a strategy whose holdings have a buy thesis (recorded via memories or strategy description), checks each monitoring run whether new data still supports the thesis.

- [ ] **Step 1: Read source**

Run: `cat ~/code/ai-berkshire/skills/thesis-tracker.md`

- [ ] **Step 2: Apply Adaptation Procedure**

Required frontmatter:

```yaml
---
name: thesis-tracker
description: 买入后的论文追踪纪律：每次监控时验伪原 thesis，明确「仍成立 / 部分动摇 / 已破产」三态，破产即建议清仓。
category: process
---
```

Must-keep: thesis 三态判定标准（仍成立 / 部分动摇 / 已破产）、破产即清仓的硬规则、对常见 thesis 漂移（"虽然 X 没发生，但 Y 也不错"）的识别提示。

Must remove: 任何"建文件夹 reports/<公司>/thesis.md"的指引（trader 用 memories 表，不用文件）；slash-command 入参解析段。

Top-of-body framing line:

```
对当前持仓中的每个标的，请回忆 strategy 描述 / 用户笔记中的 thesis（如有），逐条核对最新数据是否仍支持，明确给出「仍成立 / 部分动摇 / 已破产」结论。
```

- [ ] **Step 3: Verify & Commit**

---

### Task 6: Add `portfolio-review.md` (category: process)

**Files:**
- Source: `~/code/ai-berkshire/skills/portfolio-review.md`
- Create: `packages/db/seed/skills/portfolio-review.md`

**Interfaces:**
- Consumes: ai-berkshire 组合管理 framework.
- Produces: A skill that switches the LLM from "single strategy" view to "全部持仓 portfolio-level" view — concentration, quality balance, valuation balance, opportunity cost.

- [ ] **Step 1: Read source**

Run: `cat ~/code/ai-berkshire/skills/portfolio-review.md`

- [ ] **Step 2: Apply Adaptation Procedure**

Required frontmatter:

```yaml
---
name: portfolio-review
description: 组合管理视角：从单标的切换到整体持仓，评估集中度 / 质量分层 / 估值分层 / 机会成本，发现结构性问题。
category: process
---
```

Must-keep: 集中度阈值表（单仓 / 前三大 / 行业占比的红线）；质量分层框架（一流 / 中等 / 留待去化）；估值分层框架。

Must remove: 「研究公司」与「管理组合」的对比性长段（保留一句话总结即可）。

Top-of-body framing line:

```
请把分析对象从单 strategy 切换到「全部持仓」视角，按集中度 / 质量 / 估值三维度评估组合是否需要再平衡，给出具体调整建议（包含数字）。
```

- [ ] **Step 3: Verify & Commit**

---

### Task 7: Add `earnings-review.md` (category: fundamental)

**Files:**
- Source: `~/code/ai-berkshire/skills/earnings-review.md`
- Create: `packages/db/seed/skills/earnings-review.md`

**Interfaces:**
- Consumes: ai-berkshire 财报精读 framework.
- Produces: A skill that activates when a strategy involves earnings triggers or a holding has had earnings in the last 30 days — provides a structured reading framework.

- [ ] **Step 1: Read source**

Run: `cat ~/code/ai-berkshire/skills/earnings-review.md`

- [ ] **Step 2: Apply Adaptation Procedure**

Required frontmatter:

```yaml
---
name: earnings-review
description: 财报精读框架：从一手 PR + 财报表，提取增长质量 / 现金流 / 管理层 commentary 三层信号，给「超预期 / 符合 / 不及」结论。
category: fundamental
---
```

Must-keep: 一手资料 vs 二手解读 的区分；财务表三层信号（增长质量 / 现金流 / 资产负债表变化）；管理层 commentary 的红旗清单。

Must remove: 「四大师并行解读」(那是 earnings-team skill 的事，不在 trader 移植范围)；「reports/{公司}/{季度}.md」文件路径指引；公众号文章产出 (wechat-article skill 的事)。

Top-of-body framing line:

```
若 strategy 含财报触发规则，或当前持仓在近 30 天内发布过财报，请按下面框架精读该财报，输出「超预期 / 符合 / 不及」结论 + 三层证据。
```

- [ ] **Step 3: Verify & Commit**

---

### Task 8: Add `news-pulse.md` (category: fundamental)

**Files:**
- Source: `~/code/ai-berkshire/skills/news-pulse.md`
- Create: `packages/db/seed/skills/news-pulse.md`

**Interfaces:**
- Consumes: ai-berkshire 新闻分析 framework.
- Produces: A skill that pairs with trader's existing news module — instead of summarizing news verbosely, identify actual impact on held positions.

- [ ] **Step 1: Read source**

Run: `cat ~/code/ai-berkshire/skills/news-pulse.md`

- [ ] **Step 2: Apply Adaptation Procedure**

Required frontmatter:

```yaml
---
name: news-pulse
description: 新闻脉搏：对新闻去噪、识别对持仓的实际影响，分「直接打击业绩 / 长期 thesis 影响 / 仅噪音」三类，不做泛泛点评。
category: fundamental
---
```

Must-keep: 新闻三类分级（直接打击业绩 / 长期 thesis 影响 / 仅噪音）；识别"仅噪音"的红旗（媒体跟风、二手转述、未具名消息源）。

Must remove: 关键词检索方法（trader 的 news 模块已经做了抓取 + 摘要）。

Top-of-body framing line:

```
基于 trader 的新闻摘要 / 用户提供的新闻片段，请对每条新闻分类（直接打击业绩 / 长期 thesis 影响 / 仅噪音），仅前两类给出操作建议，第三类一句话带过。
```

- [ ] **Step 3: Verify & Commit**

---

### Task 9: Add `management-deep-dive.md` (category: fundamental)

**Files:**
- Source: `~/code/ai-berkshire/skills/management-deep-dive.md`
- Create: `packages/db/seed/skills/management-deep-dive.md`

**Interfaces:**
- Consumes: ai-berkshire 管理层评估 framework.
- Produces: A skill for evaluating management quality — used on core holdings (large position sizes).

- [ ] **Step 1: Read source**

Run: `cat ~/code/ai-berkshire/skills/management-deep-dive.md`

- [ ] **Step 2: Apply Adaptation Procedure**

Required frontmatter:

```yaml
---
name: management-deep-dive
description: 管理层纵深评估：从履历 / 持股 / 资本配置记录 / 关键决策 四维评分管理层；用于核心持仓的深度复核。
category: fundamental
---
```

Must-keep: 四维评分框架；资本配置评估的具体指标（回购 vs 派息 vs 再投资 vs 并购的历史决策对错）；管理层红旗清单（频繁发股、薪酬异常、关联交易、关键岗位流失）。

Must remove: 「适合用于建仓前调研」之类的研究项目语境；多 Agent 并行调研段。

Top-of-body framing line:

```
请对当前持仓中权重较大的标的（≥ 总仓 20%）的管理层进行四维评估（履历 / 持股 / 资本配置 / 关键决策），输出红旗清单 + 综合评分 1-5。
```

- [ ] **Step 3: Verify & Commit**

---

### Task 10: Add `dyp-ask.md` (category: behavioral)

**Files:**
- Source: `~/code/ai-berkshire/skills/dyp-ask.md`
- Create: `packages/db/seed/skills/dyp-ask.md`

**Interfaces:**
- Consumes: ai-berkshire 段永平问答 framework (a set of probing questions in Duan Yongping's style).
- Produces: A skill that, when attached, has the LLM run a set of "Duan Yongping-style" rhetorical questions against the current decision context — anti-rationalization aid.

- [ ] **Step 1: Read source**

Run: `cat ~/code/ai-berkshire/skills/dyp-ask.md`

- [ ] **Step 2: Apply Adaptation Procedure**

Required frontmatter:

```yaml
---
name: dyp-ask
description: 段永平式反问清单：以本生意 10 年后还在吗 / 管理层在乎股东吗 / 是否做对的事这一类反问，破除决策合理化。
category: behavioral
---
```

Must-keep: 8-12 个核心反问 + 每问的"通过 / 不通过"判定。

Must remove: 「输入：公司名称」入参声明；任何为某一具体公司给出的长 case study（保留 1-2 句话级的例子即可）。

Top-of-body framing line:

```
对当前 strategy 的核心持仓或即将买入的标的，请用段永平风格的反问逐条审视，如出现任意 3 条以上"不通过"，建议放弃本次决策。
```

- [ ] **Step 3: Verify & Commit**

---

## Phase 3.5 — Adapted Seed Assertions

### Task 11: Extend seed validation for ai-berkshire adapted files

**Files:**
- Modify: `packages/db/src/seed-skills.test.ts`

**Interfaces:**
- Consumes: all 8 new files created in Tasks 3-10.
- Produces: tests that lock down OpenSpec requirements for exact filenames, category mapping, source notes, and forbidden workflow tokens.

- [ ] **Step 1: Extend the seed-skills test with adapted-specific constants**

In `packages/db/src/seed-skills.test.ts`, after `const BODY_MAX = 6000;`, add:

```ts
const ADAPTED_SEED_CATEGORIES: Record<string, string> = {
  "quality-screen": "fundamental",
  "investment-checklist": "fundamental",
  "thesis-tracker": "process",
  "portfolio-review": "process",
  "earnings-review": "fundamental",
  "news-pulse": "fundamental",
  "management-deep-dive": "fundamental",
  "dyp-ask": "behavioral",
};

const FORBIDDEN_ADAPTED_PATTERNS = [
  /\$ARGUMENTS/,
  /\bTask\b/,
  /并行\s*Agent/,
  /parallel\s+Agent/i,
  /python3\s+~\/ai-berkshire/,
  /reports\//,
];
```

- [ ] **Step 2: Add existence + category mapping test**

Still inside `describe("seed/skills/*.md", () => { ... })`, after the existing uniqueness test, add:

```ts
  it("contains all ai-berkshire adapted seed files with expected categories", () => {
    const parsedByName = new Map(
      files.map(({ raw }) => {
        const parsed = parseFrontmatter(raw);
        return [parsed.name, parsed];
      })
    );

    for (const [name, category] of Object.entries(ADAPTED_SEED_CATEGORIES)) {
      expect(parsedByName.has(name)).toBe(true);
      expect(parsedByName.get(name)?.category).toBe(category);
    }
  });
```

- [ ] **Step 3: Add source note + forbidden token scan**

Still inside `describe("seed/skills/*.md", () => { ... })`, after the category mapping test, add:

```ts
  it("adapts ai-berkshire skills without slash-command workflow tokens", () => {
    const adaptedFiles = files.filter(({ fname }) =>
      Object.prototype.hasOwnProperty.call(
        ADAPTED_SEED_CATEGORIES,
        fname.replace(/\.md$/, "")
      )
    );

    for (const { fname, raw } of adaptedFiles) {
      const parsed = parseFrontmatter(raw);
      expect(parsed.bodyMd).toContain(
        `改写自 ai-berkshire/skills/${fname}`
      );
      for (const pattern of FORBIDDEN_ADAPTED_PATTERNS) {
        expect(parsed.bodyMd).not.toMatch(pattern);
      }
    }
  });
```

- [ ] **Step 4: Run the enhanced seed validation**

Run: `npm run test -w packages/db -- seed-skills`
Expected: PASS — all 13 seed files pass structural validation; the 8 ai-berkshire adapted files pass exact filename/category/source-note/forbidden-token assertions.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/seed-skills.test.ts
git commit -m "test(db): validate ai-berkshire adapted seed skills"
```

---

## Phase 4 — Final Integration Verification

### Task 12: Integration check (no code changes)

**Files:**
- None modified.

**Interfaces:**
- Consumes: outputs of Tasks 1-11.
- Produces: documented evidence that the import wizard works end-to-end with the new files.

- [ ] **Step 1: Run all relevant test suites**

```bash
npm run test -w packages/db -- seed-skills
npm run test -w apps/web -- skills
npm run build -w apps/web
```

Expected: All green. The seed-skills test now reports 13 `it.each` entries (5 original + 8 new), all passing.

If `npm run build -w apps/web` fails only with the known `apps/web/lib/position-service.ts` number/string type mismatch, document it as a pre-existing unrelated build blocker in the final handoff and do not modify that file in this change. If build fails in files touched by this change, fix before proceeding.

- [ ] **Step 2: Inspect the import wizard in an existing running environment**

Expected:
- The wizard lists all 13 seed skills with their `description` and `category` chips.
- The 8 new skills appear with status `missing` (since they haven't been imported into the db yet).
- Clicking the import button on any of them succeeds (201 response) and the skill becomes available on the `/skills` page.
- On `/skills`, the two new category sections「基本面」and「流程纪律」render with the imported skills under them.

- [ ] **Step 3: Document verification in commit message**

If the wizard works, no code changes are needed for this task. Make an empty/marker commit to record verification on the timeline:

```bash
git commit --allow-empty -m "chore: verify ai-berkshire seed skills end-to-end via /skills/import"
```

Or, if verification reveals issues (e.g., one skill's description is too vague to render usefully in the wizard catalog), file a fix in a new commit before this marker.

---

## Self-Review Summary

**Spec coverage check** — each spec requirement maps to:
- 8 markdown files in `seed/skills/` → Tasks 3-10
- `SKILL_CATEGORIES` extended with `fundamental` + `process` → Task 1
- `CATEGORY_LABELS` extended → Task 1
- Each new skill ≤ 6000 chars, no `$ARGUMENTS`, no `Task` / `python3` calls → Adaptation Procedure (Phase 3 header) + structural length check in Task 2 + adapted forbidden-token scan in Task 11 + per-skill "Must remove" lines
- Frontmatter three fields present and parseable → Task 2 test
- Seed manifest auto-discovery works → Task 12 step 2
- 「source: ai-berkshire / 改写自原 skill X」note at top of each body → Adaptation Procedure ("Top note" requirement, captured in each task's adaptation rules) + Task 11 source-note test
- Category mapping per skill (8 rows of the spec's table) → reflected in each task's frontmatter `category` field + Task 11 category mapping test
- Tests for SKILL_CATEGORIES extension non-breaking → Task 1 Step 2 + Step 3
- Manual `/skills/import` verification in an existing running environment → Task 12

No gaps detected.

**Placeholder scan** — no `TBD`, `TODO`, "appropriate", "similar to", or unhalted `待` markers. All commands are exact; all frontmatter blocks are complete; the adaptation procedure is centralized once with per-skill overrides where needed.

**Type consistency** — `SkillCategory` union extension in Task 1 is the only type change; subsequent tasks reference only the string literal categories. `parseFrontmatter` and `ParsedSkill` (from `seed-helpers.ts`) are used consistently in Task 2 and remain unchanged. No method-name drift.
