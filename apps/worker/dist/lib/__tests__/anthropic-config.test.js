// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getAnthropicConfig } from "../anthropic-config.js";
const KEYS = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_API_KEY_NEWS",
    "ANTHROPIC_BASE_URL_NEWS",
    "ANTHROPIC_MODEL_NEWS",
    "ANTHROPIC_API_KEY_MONITORING",
    "ANTHROPIC_BASE_URL_MONITORING",
    "ANTHROPIC_MODEL_MONITORING",
];
describe("getAnthropicConfig", () => {
    const original = {};
    beforeEach(() => {
        for (const k of KEYS) {
            original[k] = process.env[k];
            delete process.env[k];
        }
    });
    afterEach(() => {
        for (const k of KEYS) {
            if (original[k] === undefined)
                delete process.env[k];
            else
                process.env[k] = original[k];
        }
    });
    it("falls back to ANTHROPIC_* when no scenario override is set", () => {
        process.env.ANTHROPIC_API_KEY = "shared-key";
        process.env.ANTHROPIC_BASE_URL = "https://shared";
        process.env.ANTHROPIC_MODEL = "shared-model";
        expect(getAnthropicConfig("NEWS")).toEqual({
            apiKey: "shared-key",
            baseURL: "https://shared",
            model: "shared-model",
        });
        expect(getAnthropicConfig("MONITORING")).toEqual({
            apiKey: "shared-key",
            baseURL: "https://shared",
            model: "shared-model",
        });
    });
    it("scenario-specific override wins over the shared default", () => {
        process.env.ANTHROPIC_API_KEY = "shared-key";
        process.env.ANTHROPIC_BASE_URL = "https://shared";
        process.env.ANTHROPIC_MODEL = "shared-model";
        process.env.ANTHROPIC_API_KEY_NEWS = "news-key";
        process.env.ANTHROPIC_MODEL_NEWS = "news-model";
        expect(getAnthropicConfig("NEWS")).toEqual({
            apiKey: "news-key",
            baseURL: "https://shared",
            model: "news-model",
        });
        expect(getAnthropicConfig("MONITORING")).toEqual({
            apiKey: "shared-key",
            baseURL: "https://shared",
            model: "shared-model",
        });
    });
    it("treats empty-string overrides as unset (docker-compose ${VAR:-} case)", () => {
        process.env.ANTHROPIC_API_KEY = "shared-key";
        process.env.ANTHROPIC_BASE_URL = "https://shared";
        process.env.ANTHROPIC_MODEL = "shared-model";
        process.env.ANTHROPIC_API_KEY_NEWS = "";
        process.env.ANTHROPIC_BASE_URL_NEWS = "";
        process.env.ANTHROPIC_MODEL_NEWS = "";
        expect(getAnthropicConfig("NEWS")).toEqual({
            apiKey: "shared-key",
            baseURL: "https://shared",
            model: "shared-model",
        });
    });
    it("uses default model glm-5.1 when nothing is set", () => {
        expect(getAnthropicConfig("NEWS")).toEqual({
            apiKey: undefined,
            baseURL: undefined,
            model: "glm-5.1",
        });
    });
});
