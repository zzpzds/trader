## ADDED Requirements

### Requirement: Daily News Summary Cron

The worker SHALL register a `daily-news` pg-boss cron job that runs every day at `30 1 * * *` UTC (09:30 China Standard Time) and generates one news summary per strategy.

#### Scenario: Cron registration on worker start

- **WHEN** the worker process starts
- **THEN** it SHALL call `boss.createQueue("daily-news")`, register a worker handler that invokes `runNewsJob(db)`, and call `boss.schedule("daily-news", "30 1 * * *")`
- **AND** it SHALL log a confirmation including the cron expression

#### Scenario: Cron triggers job

- **WHEN** the scheduled time fires
- **THEN** the registered handler SHALL call `runNewsJob(db)` exactly once

### Requirement: Per-Strategy Tavily Search

For each strategy, the system SHALL query Tavily Search API once per ticker symbol (`"<symbol> stock news"`) plus once for the strategy name (`"<strategy.name> investing news"`).

#### Scenario: Tavily request shape

- **WHEN** `tavilyFetch(query)` is called with a non-empty query
- **THEN** it SHALL `POST https://api.tavily.com/search` with JSON body `{ api_key, query, search_depth: "basic", days: 1, max_results: 3 }`
- **AND** it SHALL parse `results[]` into `{ title, url, content }[]`

#### Scenario: Missing API key

- **WHEN** `process.env.TAVILY_API_KEY` is unset and `tavilyFetch` is called
- **THEN** it SHALL log a warning and return `[]` without making any HTTP call

#### Scenario: Non-2xx response

- **WHEN** Tavily responds with `ok=false` (e.g. 429, 500)
- **THEN** `tavilyFetch` SHALL log the status and return `[]`

#### Scenario: Network or parse error

- **WHEN** `fetch` throws or response JSON is malformed
- **THEN** `tavilyFetch` SHALL catch the error, log a warning, and return `[]`

### Requirement: LLM Chinese Summarization

The system SHALL summarize merged news articles for a strategy into a single Chinese text body of up to 200 characters, using the existing Anthropic SDK with `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` env overrides.

#### Scenario: Successful summary

- **WHEN** `summarizeNews(strategyName, strategyContent, articles)` is called with at least one article
- **THEN** it SHALL build a Chinese prompt that includes the strategy name, the first 300 characters of the strategy content, and the article titles + content
- **AND** it SHALL call `anthropic.messages.create` with model from `ANTHROPIC_MODEL` (default `claude-3-5-haiku-20241022`) and `max_tokens: 400`
- **AND** it SHALL return the trimmed text content of the first text block

#### Scenario: LLM call fails

- **WHEN** the Anthropic SDK throws (rate limit, network, etc.)
- **THEN** `summarizeNews` SHALL catch the error, log a warning, and return the literal string `"摘要生成失败，请稍后重试"`

#### Scenario: No-text response block

- **WHEN** the LLM returns a content block whose `type` is not `"text"`
- **THEN** `summarizeNews` SHALL return `"摘要生成失败，请稍后重试"`

### Requirement: Job Main Flow

`runNewsJob(db)` SHALL clean up records older than 7 days, fetch all strategies, and for each strategy in parallel (concurrency limit 3) gather articles, summarize, and upsert one row into `news_summaries` keyed by `(strategy_id, summary_date)`.

#### Scenario: No strategies

- **WHEN** `db.query.strategies.findMany()` returns `[]`
- **THEN** the job SHALL log a skip message and return without calling Tavily, the LLM, or insert

#### Scenario: Successful summary upsert

- **WHEN** strategies exist and Tavily / LLM succeed for a given strategy
- **THEN** the job SHALL `INSERT INTO news_summaries (strategy_id, summary_date, content, raw_articles)` with `summary_date = today (UTC YYYY-MM-DD)`
- **AND** on conflict on `(strategy_id, summary_date)` it SHALL update `content` and `raw_articles` from the new values

#### Scenario: Per-strategy isolation

- **WHEN** processing strategy A throws an unexpected error
- **THEN** the job SHALL log the error and continue processing remaining strategies
- **AND** the overall job SHALL still resolve (Promise.allSettled semantics)

#### Scenario: 7-day rolling window cleanup

- **WHEN** `runNewsJob` starts
- **THEN** before processing any strategy it SHALL `DELETE FROM news_summaries WHERE summary_date < (today - 7 days)`

#### Scenario: URL de-duplication across queries

- **WHEN** multiple Tavily queries for one strategy return the same article URL
- **THEN** the job SHALL keep only the first occurrence before passing the article list to the summarizer

### Requirement: News Summary Schema

The database SHALL contain a `news_summaries` table with the columns `id`, `strategy_id`, `summary_date`, `content`, `raw_articles`, `created_at`, a foreign key from `strategy_id` to `strategies.id` with `ON DELETE CASCADE`, and a unique index on `(strategy_id, summary_date)`.

#### Scenario: Drizzle schema export

- **WHEN** the application imports `newsSummaries` from `@trader/db`
- **THEN** the import SHALL succeed and the object SHALL expose at minimum the columns `id`, `strategyId`, `summaryDate`, `content`, `rawArticles`, `createdAt`

#### Scenario: Cascade delete

- **WHEN** a strategy row is deleted
- **THEN** all `news_summaries` rows referencing that strategy SHALL be removed by the database

#### Scenario: Unique (strategy, date)

- **WHEN** an insert would create a second row with the same `(strategy_id, summary_date)`
- **THEN** the unique constraint SHALL trigger and the application SHALL handle it via `ON CONFLICT DO UPDATE`

### Requirement: GET /api/news Endpoint

The web app SHALL expose `GET /api/news?date=YYYY-MM-DD` that returns the day's news summaries for all strategies.

#### Scenario: Specific date

- **WHEN** the client calls `GET /api/news?date=2026-05-29`
- **THEN** the route SHALL return `200` with JSON `{ date: "2026-05-29", summaries: [{ strategyId, strategyName, content }, ...] }`
- **AND** each row SHALL include the strategy name via a join on `strategies`

#### Scenario: Date defaults to today

- **WHEN** the client calls `GET /api/news` without a `date` query param
- **THEN** the route SHALL substitute today (UTC, `YYYY-MM-DD`) and return summaries for that date

#### Scenario: No data for the date

- **WHEN** no `news_summaries` rows exist for the requested date
- **THEN** the route SHALL return `200` with `summaries: []`

#### Scenario: Dynamic rendering

- **WHEN** the route is invoked
- **THEN** it SHALL be marked `dynamic = "force-dynamic"` so Next.js does not cache it across requests

### Requirement: News Hotspot Page

The web app SHALL provide a `/news` page that displays the most recent 7 days of news summaries with date-tab navigation.

#### Scenario: 7-day tab strip

- **WHEN** the page mounts
- **THEN** it SHALL render 7 buttons representing today, yesterday, and the prior 5 days
- **AND** the first button SHALL be labeled `今天`, the second `昨天`, and the rest formatted as `M/D`
- **AND** today's button SHALL be selected by default

#### Scenario: Loading state

- **WHEN** a date is selected and the fetch is in flight
- **THEN** the page SHALL render skeleton placeholders (3 muted blocks)

#### Scenario: Empty state

- **WHEN** the API returns `summaries: []`
- **THEN** the page SHALL render the message `暂无热点数据，将在每日 09:30 自动更新`

#### Scenario: Populated state

- **WHEN** the API returns one or more summaries
- **THEN** the page SHALL render one card per strategy with the strategy name as a clickable link to `/strategies/<strategyId>` and the summary content below

#### Scenario: Date switching refetches

- **WHEN** the user clicks a different date button
- **THEN** the page SHALL clear current data, show the loading state, and re-fetch `/api/news?date=...`

### Requirement: Navigation Entry

Both the desktop sidebar and the mobile bottom nav SHALL include a `热点` entry that links to `/news`, positioned immediately after `持仓` and before `策略库`, using the `Newspaper` icon from `lucide-react`.

#### Scenario: Desktop sidebar

- **WHEN** a user views the desktop sidebar
- **THEN** they SHALL see the `热点` entry between `持仓管理` and `策略库`

#### Scenario: Mobile bottom nav

- **WHEN** a user views the mobile bottom nav
- **THEN** they SHALL see the `热点` entry between `持仓` and `策略库`

### Requirement: Tavily API Key Configuration

Worker container deployment SHALL receive `TAVILY_API_KEY` via environment variable, and `.env.example` SHALL document the placeholder.

#### Scenario: docker-compose passthrough

- **WHEN** the docker-compose stack starts
- **THEN** the `worker` service environment SHALL include `TAVILY_API_KEY: ${TAVILY_API_KEY}`

#### Scenario: Local env example

- **WHEN** a developer copies `.env.example` to `.env`
- **THEN** the example SHALL contain a `TAVILY_API_KEY=` placeholder line so the variable is discoverable
