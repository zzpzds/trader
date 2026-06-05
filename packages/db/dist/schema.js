"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.newsSummariesRelations = exports.notificationsRelations = exports.monitoringRunsRelations = exports.positionLotsRelations = exports.positionsRelations = exports.memoriesRelations = exports.strategiesRelations = exports.priceSnapshots = exports.memories = exports.newsSummaries = exports.notifications = exports.monitoringRuns = exports.positionLots = exports.positions = exports.strategies = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const drizzle_orm_1 = require("drizzle-orm");
exports.strategies = (0, pg_core_1.pgTable)("strategies", {
    id: (0, pg_core_1.text)("id")
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    name: (0, pg_core_1.text)("name").notNull(),
    symbols: (0, pg_core_1.jsonb)("symbols").notNull().$type(),
    content: (0, pg_core_1.text)("content").notNull(),
    script: (0, pg_core_1.text)("script").notNull(),
    analysisWindowDays: (0, pg_core_1.integer)("analysis_window_days").notNull().default(60),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").notNull().defaultNow(),
});
exports.positions = (0, pg_core_1.pgTable)("positions", {
    id: (0, pg_core_1.text)("id")
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    strategyId: (0, pg_core_1.text)("strategy_id").references(() => exports.strategies.id, {
        onDelete: "set null",
    }),
    symbol: (0, pg_core_1.text)("symbol").notNull(),
    referencePrice: (0, pg_core_1.numeric)("reference_price", { precision: 15, scale: 4 }),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").notNull().defaultNow(),
}, (t) => [
    (0, pg_core_1.unique)("positions_strategy_id_symbol_idx")
        .on(t.strategyId, t.symbol)
        .nullsNotDistinct(),
]);
exports.positionLots = (0, pg_core_1.pgTable)("position_lots", {
    id: (0, pg_core_1.text)("id")
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    positionId: (0, pg_core_1.text)("position_id")
        .notNull()
        .references(() => exports.positions.id, { onDelete: "cascade" }),
    // BUY 行 costPrice=买入价;SELL 行 costPrice=卖出价
    type: (0, pg_core_1.text)("type", { enum: ["BUY", "SELL"] }).notNull().default("BUY"),
    shares: (0, pg_core_1.numeric)("shares", { precision: 15, scale: 4 }).notNull(),
    costPrice: (0, pg_core_1.numeric)("cost_price", { precision: 15, scale: 4 }).notNull(),
    lotDate: (0, pg_core_1.text)("lot_date").notNull(),
    notes: (0, pg_core_1.text)("notes"),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.monitoringRuns = (0, pg_core_1.pgTable)("monitoring_runs", {
    id: (0, pg_core_1.text)("id")
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    strategyId: (0, pg_core_1.text)("strategy_id")
        .notNull()
        .references(() => exports.strategies.id, { onDelete: "cascade" }),
    runDate: (0, pg_core_1.text)("run_date").notNull(),
    status: (0, pg_core_1.text)("status", {
        enum: ["pending", "completed", "failed"],
    })
        .notNull()
        .default("pending"),
    analysis: (0, pg_core_1.text)("analysis"),
    hasActionItems: (0, pg_core_1.boolean)("has_action_items"),
    prices: (0, pg_core_1.jsonb)("prices").$type(),
    error: (0, pg_core_1.text)("error"),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
}, (t) => [(0, pg_core_1.index)("monitoring_runs_strategy_date_idx").on(t.strategyId, t.runDate)]);
exports.notifications = (0, pg_core_1.pgTable)("notifications", {
    id: (0, pg_core_1.text)("id")
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    monitoringRunId: (0, pg_core_1.text)("monitoring_run_id")
        .notNull()
        .references(() => exports.monitoringRuns.id, { onDelete: "cascade" }),
    title: (0, pg_core_1.text)("title").notNull(),
    content: (0, pg_core_1.text)("content"),
    isRead: (0, pg_core_1.boolean)("is_read").notNull().default(false),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.newsSummaries = (0, pg_core_1.pgTable)("news_summaries", {
    id: (0, pg_core_1.text)("id")
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    strategyId: (0, pg_core_1.text)("strategy_id")
        .notNull()
        .references(() => exports.strategies.id, { onDelete: "cascade" }),
    summaryDate: (0, pg_core_1.text)("summary_date").notNull(),
    content: (0, pg_core_1.text)("content").notNull(),
    rawArticles: (0, pg_core_1.jsonb)("raw_articles").$type(),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
}, (t) => [(0, pg_core_1.uniqueIndex)("news_summaries_strategy_date_idx").on(t.strategyId, t.summaryDate)]);
exports.memories = (0, pg_core_1.pgTable)("memories", {
    id: (0, pg_core_1.text)("id")
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    title: (0, pg_core_1.text)("title").notNull(),
    content: (0, pg_core_1.text)("content").notNull(),
    kind: (0, pg_core_1.text)("kind", { enum: ["note", "idea", "lesson", "context"] })
        .notNull()
        .default("note"),
    strategyId: (0, pg_core_1.text)("strategy_id").references(() => exports.strategies.id, {
        onDelete: "set null",
    }),
    symbol: (0, pg_core_1.text)("symbol"),
    tags: (0, pg_core_1.jsonb)("tags").$type().notNull().default([]),
    pinned: (0, pg_core_1.boolean)("pinned").notNull().default(false),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").notNull().defaultNow(),
}, (t) => [
    (0, pg_core_1.index)("memories_strategy_idx").on(t.strategyId),
    (0, pg_core_1.index)("memories_symbol_idx").on(t.symbol),
    (0, pg_core_1.index)("memories_pinned_idx").on(t.pinned),
]);
exports.priceSnapshots = (0, pg_core_1.pgTable)("price_snapshots", {
    symbol: (0, pg_core_1.text)("symbol").notNull(),
    date: (0, pg_core_1.date)("date").notNull(),
    open: (0, pg_core_1.numeric)("open", { precision: 15, scale: 4 }).notNull(),
    high: (0, pg_core_1.numeric)("high", { precision: 15, scale: 4 }).notNull(),
    low: (0, pg_core_1.numeric)("low", { precision: 15, scale: 4 }).notNull(),
    close: (0, pg_core_1.numeric)("close", { precision: 15, scale: 4 }).notNull(),
    volume: (0, pg_core_1.bigint)("volume", { mode: "bigint" }),
    fetchedAt: (0, pg_core_1.timestamp)("fetched_at").notNull().defaultNow(),
}, (t) => [
    (0, pg_core_1.primaryKey)({ columns: [t.symbol, t.date] }),
    (0, pg_core_1.index)("price_snapshots_symbol_date_desc_idx").on(t.symbol, t.date.desc()),
]);
exports.strategiesRelations = (0, drizzle_orm_1.relations)(exports.strategies, ({ many }) => ({
    positions: many(exports.positions),
    monitoringRuns: many(exports.monitoringRuns),
    newsSummaries: many(exports.newsSummaries),
    memories: many(exports.memories),
}));
exports.memoriesRelations = (0, drizzle_orm_1.relations)(exports.memories, ({ one }) => ({
    strategy: one(exports.strategies, {
        fields: [exports.memories.strategyId],
        references: [exports.strategies.id],
    }),
}));
exports.positionsRelations = (0, drizzle_orm_1.relations)(exports.positions, ({ one, many }) => ({
    strategy: one(exports.strategies, {
        fields: [exports.positions.strategyId],
        references: [exports.strategies.id],
    }),
    positionLots: many(exports.positionLots),
}));
exports.positionLotsRelations = (0, drizzle_orm_1.relations)(exports.positionLots, ({ one }) => ({
    position: one(exports.positions, {
        fields: [exports.positionLots.positionId],
        references: [exports.positions.id],
    }),
}));
exports.monitoringRunsRelations = (0, drizzle_orm_1.relations)(exports.monitoringRuns, ({ one }) => ({
    strategy: one(exports.strategies, {
        fields: [exports.monitoringRuns.strategyId],
        references: [exports.strategies.id],
    }),
}));
exports.notificationsRelations = (0, drizzle_orm_1.relations)(exports.notifications, ({ one }) => ({
    monitoringRun: one(exports.monitoringRuns, {
        fields: [exports.notifications.monitoringRunId],
        references: [exports.monitoringRuns.id],
    }),
}));
exports.newsSummariesRelations = (0, drizzle_orm_1.relations)(exports.newsSummaries, ({ one }) => ({
    strategy: one(exports.strategies, {
        fields: [exports.newsSummaries.strategyId],
        references: [exports.strategies.id],
    }),
}));
