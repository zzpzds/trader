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
    (0, vitest_1.it)("positionLots.shares is numeric(15,4) (supports decimals)", () => {
        const col = schema_1.positionLots.shares;
        (0, vitest_1.expect)(col.columnType).toBe("PgNumeric");
        (0, vitest_1.expect)(col.precision).toBe(15);
        (0, vitest_1.expect)(col.scale).toBe(4);
    });
});
