## 1. Category Extension

- [x] 1.1 Update `apps/web/lib/skills-ui.ts` so `SKILL_CATEGORIES` includes `fundamental` and `process` before `other`
- [x] 1.2 Add `CATEGORY_LABELS.fundamental = "基本面"` and `CATEGORY_LABELS.process = "流程纪律"`
- [x] 1.3 Run `npm run test -w apps/web -- skills` and confirm skills-related tests pass
- [x] 1.4 Run `npm run build -w apps/web` and record whether any failures are caused by this change or pre-existing unrelated type issues — failed only on pre-existing `apps/web/lib/position-service.ts:39` number/string type mismatch

## 2. Seed File Validation Test

- [x] 2.1 Add `packages/db/src/seed-skills.test.ts` to scan `packages/db/seed/skills/*.md`
- [x] 2.2 Validate each seed file parses with `parseFrontmatter`
- [x] 2.3 Validate each seed file has `name` matching filename stem, non-empty `description`, legal `category`, and `bodyMd.length <= 6000`
- [x] 2.4 Validate all seed skill names are globally unique
- [x] 2.5 Run `npm run test -w packages/db -- seed-skills` against the existing 5 seed files and confirm it passes
- [x] 2.6 Validate the 8 ai-berkshire adapted seed files exist with expected category mapping
- [x] 2.7 Validate adapted seed files include source notes and exclude slash-command workflow tokens

## 3. Shared Adaptation Rules

- [x] 3.1 For every ai-berkshire source skill, remove `$ARGUMENTS`, `Task` tool dispatch, parallel Agent choreography, `python3 ~/ai-berkshire/...` calls, and `reports/` output paths
- [x] 3.2 Reframe every adapted body for the current trader strategy/position/news/memory context rather than slash-command company input
- [x] 3.3 Add a top note to every adapted body identifying the original `ai-berkshire/skills/<name>.md` source and stating that external workflow calls were removed
- [x] 3.4 Preserve each source skill's required tables, scoring rubrics, exclusion rules, hard vetoes, decision trees, and exemption rules while keeping body length within 6000 characters

## 4. Fundamental Seed Skills

- [x] 4.1 Read `~/code/ai-berkshire/skills/quality-screen.md` and create `packages/db/seed/skills/quality-screen.md` with category `fundamental`
- [x] 4.2 Ensure `quality-screen` preserves the 7 hard exclusion indicators, 3 exemption rules, and design principle that it should not wrongly exclude truly first-class companies
- [x] 4.3 Read `~/code/ai-berkshire/skills/investment-checklist.md` and create `packages/db/seed/skills/investment-checklist.md` with category `fundamental`
- [x] 4.4 Ensure `investment-checklist` preserves the six gates: circle of competence, economics, moat, management, valuation, and risk, with scoring and hard veto rules
- [x] 4.5 Read `~/code/ai-berkshire/skills/earnings-review.md` and create `packages/db/seed/skills/earnings-review.md` with category `fundamental`
- [x] 4.6 Ensure `earnings-review` preserves first-party vs second-party source distinction, growth quality, cash flow, balance sheet change, and management commentary red flags
- [x] 4.7 Read `~/code/ai-berkshire/skills/news-pulse.md` and create `packages/db/seed/skills/news-pulse.md` with category `fundamental`
- [x] 4.8 Ensure `news-pulse` preserves the three news impact classes and noise-identification red flags
- [x] 4.9 Read `~/code/ai-berkshire/skills/management-deep-dive.md` and create `packages/db/seed/skills/management-deep-dive.md` with category `fundamental`
- [x] 4.10 Ensure `management-deep-dive` preserves the four-dimensional management scoring framework, capital allocation indicators, and management red flag checklist
- [x] 4.11 Run `npm run test -w packages/db -- seed-skills` after adding each fundamental seed file

## 5. Process and Behavioral Seed Skills

- [x] 5.1 Read `~/code/ai-berkshire/skills/thesis-tracker.md` and create `packages/db/seed/skills/thesis-tracker.md` with category `process`
- [x] 5.2 Ensure `thesis-tracker` preserves the three thesis states, the hard rule that broken thesis implies exit, and thesis-drift detection prompts
- [x] 5.3 Read `~/code/ai-berkshire/skills/portfolio-review.md` and create `packages/db/seed/skills/portfolio-review.md` with category `process`
- [x] 5.4 Ensure `portfolio-review` preserves concentration thresholds, quality tiering, valuation tiering, and concrete rebalance recommendation format
- [x] 5.5 Read `~/code/ai-berkshire/skills/dyp-ask.md` and create `packages/db/seed/skills/dyp-ask.md` with category `behavioral`
- [x] 5.6 Ensure `dyp-ask` preserves 8 to 12 core Duan Yongping-style probing questions and pass/fail criteria for each question
- [x] 5.7 Run `npm run test -w packages/db -- seed-skills` after adding each process or behavioral seed file

## 6. Final Verification

- [x] 6.1 Run `npm run test -w packages/db -- seed-skills` and confirm all 13 seed files pass validation
- [x] 6.2 Run `npm run test -w apps/web -- skills` and confirm skills-related tests pass
- [x] 6.3 Run `npm run build -w apps/web` and resolve or document any unrelated pre-existing failure separately — failed only on pre-existing `apps/web/lib/position-service.ts:39` number/string type mismatch
- [x] 6.4 Confirm `/skills/import` manifest data lists all 13 seed skills with descriptions and category chips via `npm run test -w apps/web -- skills`
- [x] 6.5 Confirm importing at least one new seed skill preserves its expected `/skills` category via `npm run test -w apps/web -- skills`
- [x] 6.6 Run `openspec validate ai-berkshire-skills-seed-expansion --strict`
