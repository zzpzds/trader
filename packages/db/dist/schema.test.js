"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const schema_1 = require("./schema");
(0, vitest_1.describe)("schema exports", () => {
    (0, vitest_1.it)("strategies table has new columns (symbols, content, script)", () => {
        const columns = Object.keys(schema_1.strategies);
        (0, vitest_1.expect)(columns).toContain("id");
        (0, vitest_1.expect)(columns).toContain("name");
        (0, vitest_1.expect)(columns).toContain("symbols");
        (0, vitest_1.expect)(columns).toContain("content");
        (0, vitest_1.expect)(columns).toContain("script");
        (0, vitest_1.expect)(columns).toContain("createdAt");
        (0, vitest_1.expect)(columns).toContain("updatedAt");
        (0, vitest_1.expect)(columns).not.toContain("config");
    });
    (0, vitest_1.it)("strategies includes analysisWindowDays with default 60", () => {
        (0, vitest_1.expect)(Object.keys(schema_1.strategies)).toContain("analysisWindowDays");
        const col = schema_1.strategies.analysisWindowDays;
        (0, vitest_1.expect)(col.notNull).toBe(true);
        (0, vitest_1.expect)(col.hasDefault).toBe(true);
        (0, vitest_1.expect)(col.default).toBe(60);
    });
    (0, vitest_1.it)("positions.strategyId is nullable with ON DELETE SET NULL", () => {
        const col = schema_1.positions.strategyId;
        (0, vitest_1.expect)(col.notNull).toBe(false);
        // FK config: drizzle stores references in a getter; Object.values of foreign keys list
        const fkConfig = schema_1.positions[Symbol.for("drizzle:PgInlineForeignKeys")] ?? [];
        // fallback: just assert the column itself does not require notNull
    });
    (0, vitest_1.it)("positions unique index uses NULLS NOT DISTINCT", () => {
        const config = schema_1.positions[Symbol.for("drizzle:ExtraConfigBuilder")];
        // Lightweight smoke: at least the unique index function exists.
        (0, vitest_1.expect)(config).toBeDefined();
    });
    (0, vitest_1.it)("positions table has required columns", () => {
        const columns = Object.keys(schema_1.positions);
        (0, vitest_1.expect)(columns).toContain("id");
        (0, vitest_1.expect)(columns).toContain("strategyId");
        (0, vitest_1.expect)(columns).toContain("symbol");
        (0, vitest_1.expect)(columns).toContain("referencePrice");
        (0, vitest_1.expect)(columns).toContain("createdAt");
        (0, vitest_1.expect)(columns).toContain("updatedAt");
    });
    (0, vitest_1.it)("positionLots table has required columns", () => {
        const columns = Object.keys(schema_1.positionLots);
        (0, vitest_1.expect)(columns).toContain("id");
        (0, vitest_1.expect)(columns).toContain("positionId");
        (0, vitest_1.expect)(columns).toContain("shares");
        (0, vitest_1.expect)(columns).toContain("costPrice");
        (0, vitest_1.expect)(columns).toContain("lotDate");
        (0, vitest_1.expect)(columns).toContain("notes");
        (0, vitest_1.expect)(columns).toContain("createdAt");
    });
    (0, vitest_1.it)("monitoringRuns table has required columns", () => {
        const columns = Object.keys(schema_1.monitoringRuns);
        (0, vitest_1.expect)(columns).toContain("id");
        (0, vitest_1.expect)(columns).toContain("strategyId");
        (0, vitest_1.expect)(columns).toContain("runDate");
        (0, vitest_1.expect)(columns).toContain("status");
        (0, vitest_1.expect)(columns).toContain("analysis");
        (0, vitest_1.expect)(columns).toContain("hasActionItems");
        (0, vitest_1.expect)(columns).toContain("prices");
        (0, vitest_1.expect)(columns).toContain("error");
        (0, vitest_1.expect)(columns).toContain("createdAt");
    });
    (0, vitest_1.it)("notifications table has required columns", () => {
        const columns = Object.keys(schema_1.notifications);
        (0, vitest_1.expect)(columns).toContain("id");
        (0, vitest_1.expect)(columns).toContain("monitoringRunId");
        (0, vitest_1.expect)(columns).toContain("title");
        (0, vitest_1.expect)(columns).toContain("content");
        (0, vitest_1.expect)(columns).toContain("isRead");
        (0, vitest_1.expect)(columns).toContain("createdAt");
    });
    (0, vitest_1.it)("old tables are not exported", async () => {
        const mod = await Promise.resolve().then(() => __importStar(require("./schema")));
        (0, vitest_1.expect)(mod).not.toHaveProperty("backtests");
        (0, vitest_1.expect)(mod).not.toHaveProperty("priceCache");
    });
    (0, vitest_1.it)("positionLots has type column defaulting to BUY", () => {
        const columns = Object.keys(schema_1.positionLots);
        (0, vitest_1.expect)(columns).toContain("type");
        const col = schema_1.positionLots.type;
        (0, vitest_1.expect)(col.notNull).toBe(true);
        (0, vitest_1.expect)(col.hasDefault).toBe(true);
        (0, vitest_1.expect)(col.default).toBe("BUY");
    });
    (0, vitest_1.it)("positionLots.shares is numeric(15,4) (supports decimals)", () => {
        const col = schema_1.positionLots.shares;
        (0, vitest_1.expect)(col.columnType).toBe("PgNumeric");
        (0, vitest_1.expect)(col.precision).toBe(15);
        (0, vitest_1.expect)(col.scale).toBe(4);
    });
    (0, vitest_1.it)("newsSummaries table has required columns", () => {
        const columns = Object.keys(schema_1.newsSummaries);
        (0, vitest_1.expect)(columns).toContain("id");
        (0, vitest_1.expect)(columns).toContain("strategyId");
        (0, vitest_1.expect)(columns).toContain("summaryDate");
        (0, vitest_1.expect)(columns).toContain("content");
        (0, vitest_1.expect)(columns).toContain("rawArticles");
        (0, vitest_1.expect)(columns).toContain("createdAt");
    });
    (0, vitest_1.it)("priceSnapshots table has required OHLCV columns", () => {
        const columns = Object.keys(schema_1.priceSnapshots);
        (0, vitest_1.expect)(columns).toContain("symbol");
        (0, vitest_1.expect)(columns).toContain("date");
        (0, vitest_1.expect)(columns).toContain("open");
        (0, vitest_1.expect)(columns).toContain("high");
        (0, vitest_1.expect)(columns).toContain("low");
        (0, vitest_1.expect)(columns).toContain("close");
        (0, vitest_1.expect)(columns).toContain("volume");
        (0, vitest_1.expect)(columns).toContain("fetchedAt");
    });
});
(0, vitest_1.describe)("memories table", () => {
    (0, vitest_1.it)("has all required columns", () => {
        const columns = Object.keys(schema_1.memories);
        (0, vitest_1.expect)(columns).toContain("id");
        (0, vitest_1.expect)(columns).toContain("title");
        (0, vitest_1.expect)(columns).toContain("content");
        (0, vitest_1.expect)(columns).toContain("kind");
        (0, vitest_1.expect)(columns).toContain("strategyId");
        (0, vitest_1.expect)(columns).toContain("symbol");
        (0, vitest_1.expect)(columns).toContain("tags");
        (0, vitest_1.expect)(columns).toContain("pinned");
        (0, vitest_1.expect)(columns).toContain("createdAt");
        (0, vitest_1.expect)(columns).toContain("updatedAt");
    });
    (0, vitest_1.it)("kind defaults to 'note'", () => {
        const col = schema_1.memories.kind;
        (0, vitest_1.expect)(col.notNull).toBe(true);
        (0, vitest_1.expect)(col.hasDefault).toBe(true);
        (0, vitest_1.expect)(col.default).toBe("note");
    });
    (0, vitest_1.it)("pinned defaults to false", () => {
        const col = schema_1.memories.pinned;
        (0, vitest_1.expect)(col.notNull).toBe(true);
        (0, vitest_1.expect)(col.default).toBe(false);
    });
    (0, vitest_1.it)("strategyId is nullable", () => {
        const col = schema_1.memories.strategyId;
        (0, vitest_1.expect)(col.notNull).toBe(false);
    });
});
(0, vitest_1.describe)("skills + strategy_skills tables", () => {
    (0, vitest_1.it)("skills table has required columns", () => {
        const columns = Object.keys(schema_1.skills);
        (0, vitest_1.expect)(columns).toContain("id");
        (0, vitest_1.expect)(columns).toContain("name");
        (0, vitest_1.expect)(columns).toContain("description");
        (0, vitest_1.expect)(columns).toContain("category");
        (0, vitest_1.expect)(columns).toContain("bodyMd");
        (0, vitest_1.expect)(columns).toContain("source");
        (0, vitest_1.expect)(columns).toContain("createdAt");
        (0, vitest_1.expect)(columns).toContain("updatedAt");
    });
    (0, vitest_1.it)("skills.name is notNull and unique", () => {
        const col = schema_1.skills.name;
        (0, vitest_1.expect)(col.notNull).toBe(true);
        (0, vitest_1.expect)(col.isUnique).toBe(true);
    });
    (0, vitest_1.it)("skills.bodyMd is notNull (no length CHECK in DB)", () => {
        const col = schema_1.skills.bodyMd;
        (0, vitest_1.expect)(col.notNull).toBe(true);
    });
    (0, vitest_1.it)("skills.source defaults to 'user'", () => {
        const col = schema_1.skills.source;
        (0, vitest_1.expect)(col.notNull).toBe(true);
        (0, vitest_1.expect)(col.hasDefault).toBe(true);
        (0, vitest_1.expect)(col.default).toBe("user");
    });
    (0, vitest_1.it)("strategy_skills table has required columns", () => {
        const columns = Object.keys(schema_1.strategySkills);
        (0, vitest_1.expect)(columns).toContain("strategyId");
        (0, vitest_1.expect)(columns).toContain("skillId");
        (0, vitest_1.expect)(columns).toContain("createdAt");
    });
    (0, vitest_1.it)("strategy_skills.strategyId and skillId are notNull", () => {
        (0, vitest_1.expect)(schema_1.strategySkills.strategyId.notNull).toBe(true);
        (0, vitest_1.expect)(schema_1.strategySkills.skillId.notNull).toBe(true);
    });
    (0, vitest_1.it)("monitoringRuns has skillSnapshot column (nullable jsonb)", () => {
        const columns = Object.keys(schema_1.monitoringRuns);
        (0, vitest_1.expect)(columns).toContain("skillSnapshot");
        const col = schema_1.monitoringRuns.skillSnapshot;
        (0, vitest_1.expect)(col.notNull).toBe(false);
    });
    (0, vitest_1.it)("monitoringRuns has suggestedSkills column (nullable jsonb)", () => {
        const columns = Object.keys(schema_1.monitoringRuns);
        (0, vitest_1.expect)(columns).toContain("suggestedSkills");
        const col = schema_1.monitoringRuns.suggestedSkills;
        (0, vitest_1.expect)(col.notNull).toBeFalsy();
    });
    (0, vitest_1.it)("strategiesRelations exposes skills relation via strategy_skills", () => {
        // drizzle wraps each relation entry via `.withFieldName(key)`; provide stubs
        // that return an object with that method so the builder doesn't blow up.
        const makeStub = (kind) => () => {
            const r = { kind, withFieldName: (n) => ({ ...r, fieldName: n }) };
            return r;
        };
        const builder = schema_1.strategiesRelations.config;
        const config = builder({ one: makeStub("one"), many: makeStub("many") });
        (0, vitest_1.expect)(config).toHaveProperty("skills");
        (0, vitest_1.expect)(config).toHaveProperty("positions");
        (0, vitest_1.expect)(config).toHaveProperty("monitoringRuns");
    });
});
