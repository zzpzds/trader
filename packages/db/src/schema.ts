import {
  pgTable,
  text,
  timestamp,
  jsonb,
  numeric,
  boolean,
  integer,
  uniqueIndex,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const strategies = pgTable("strategies", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  symbols: jsonb("symbols").notNull().$type<string[]>(),
  content: text("content").notNull(),
  script: text("script").notNull(),
  analysisWindowDays: integer("analysis_window_days").notNull().default(60),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const positions = pgTable(
  "positions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    strategyId: text("strategy_id").references(() => strategies.id, {
      onDelete: "set null",
    }),
    symbol: text("symbol").notNull(),
    referencePrice: numeric("reference_price", { precision: 15, scale: 4 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("positions_strategy_id_symbol_idx")
      .on(t.strategyId, t.symbol)
      .nullsNotDistinct(),
  ]
);

export const positionLots = pgTable("position_lots", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  positionId: text("position_id")
    .notNull()
    .references(() => positions.id, { onDelete: "cascade" }),
  shares: numeric("shares", { precision: 15, scale: 4 }).notNull(),
  costPrice: numeric("cost_price", { precision: 15, scale: 4 }).notNull(),
  lotDate: text("lot_date").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const monitoringRuns = pgTable(
  "monitoring_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    strategyId: text("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "cascade" }),
    runDate: text("run_date").notNull(),
    status: text("status", {
      enum: ["pending", "completed", "failed"],
    })
      .notNull()
      .default("pending"),
    analysis: text("analysis"),
    hasActionItems: boolean("has_action_items"),
    prices: jsonb("prices").$type<Record<string, number>>(),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("monitoring_runs_strategy_date_idx").on(t.strategyId, t.runDate)]
);

export const notifications = pgTable("notifications", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  monitoringRunId: text("monitoring_run_id")
    .notNull()
    .references(() => monitoringRuns.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const newsSummaries = pgTable(
  "news_summaries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    strategyId: text("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "cascade" }),
    summaryDate: text("summary_date").notNull(),
    content: text("content").notNull(),
    rawArticles: jsonb("raw_articles").$type<Array<{ title: string; url: string; content: string }>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("news_summaries_strategy_date_idx").on(t.strategyId, t.summaryDate)]
);

export type StrategyRow = typeof strategies.$inferSelect;
export type NewStrategyRow = typeof strategies.$inferInsert;
export type PositionRow = typeof positions.$inferSelect;
export type NewPositionRow = typeof positions.$inferInsert;
export type PositionLotRow = typeof positionLots.$inferSelect;
export type NewPositionLotRow = typeof positionLots.$inferInsert;
export type MonitoringRunRow = typeof monitoringRuns.$inferSelect;
export type NewMonitoringRunRow = typeof monitoringRuns.$inferInsert;
export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;
export type NewsSummaryRow = typeof newsSummaries.$inferSelect;
export type NewNewsSummaryRow = typeof newsSummaries.$inferInsert;

export const strategiesRelations = relations(strategies, ({ many }) => ({
  positions: many(positions),
  monitoringRuns: many(monitoringRuns),
  newsSummaries: many(newsSummaries),
}));

export const positionsRelations = relations(positions, ({ one, many }) => ({
  strategy: one(strategies, {
    fields: [positions.strategyId],
    references: [strategies.id],
  }),
  positionLots: many(positionLots),
}));

export const positionLotsRelations = relations(positionLots, ({ one }) => ({
  position: one(positions, {
    fields: [positionLots.positionId],
    references: [positions.id],
  }),
}));

export const monitoringRunsRelations = relations(monitoringRuns, ({ one }) => ({
  strategy: one(strategies, {
    fields: [monitoringRuns.strategyId],
    references: [strategies.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  monitoringRun: one(monitoringRuns, {
    fields: [notifications.monitoringRunId],
    references: [monitoringRuns.id],
  }),
}));

export const newsSummariesRelations = relations(newsSummaries, ({ one }) => ({
  strategy: one(strategies, {
    fields: [newsSummaries.strategyId],
    references: [strategies.id],
  }),
}));
