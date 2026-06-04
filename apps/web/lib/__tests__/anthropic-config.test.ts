// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getAnthropicConfig } from "../anthropic-config";

const KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_API_KEY_PARSE",
  "ANTHROPIC_BASE_URL_PARSE",
  "ANTHROPIC_MODEL_PARSE",
] as const;

describe("getAnthropicConfig (web)", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      original[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it("falls back to ANTHROPIC_* when no PARSE override is set", () => {
    process.env.ANTHROPIC_API_KEY = "shared-key";
    process.env.ANTHROPIC_BASE_URL = "https://shared";
    process.env.ANTHROPIC_MODEL = "shared-model";

    expect(getAnthropicConfig("PARSE")).toEqual({
      apiKey: "shared-key",
      baseURL: "https://shared",
      model: "shared-model",
    });
  });

  it("PARSE override wins over shared default", () => {
    process.env.ANTHROPIC_API_KEY = "shared-key";
    process.env.ANTHROPIC_MODEL = "shared-model";
    process.env.ANTHROPIC_API_KEY_PARSE = "parse-key";
    process.env.ANTHROPIC_MODEL_PARSE = "parse-model";

    expect(getAnthropicConfig("PARSE")).toEqual({
      apiKey: "parse-key",
      baseURL: undefined,
      model: "parse-model",
    });
  });

  it("treats empty-string overrides as unset (docker-compose ${VAR:-} case)", () => {
    process.env.ANTHROPIC_API_KEY = "shared-key";
    process.env.ANTHROPIC_BASE_URL = "https://shared";
    process.env.ANTHROPIC_MODEL = "shared-model";
    process.env.ANTHROPIC_API_KEY_PARSE = "";
    process.env.ANTHROPIC_BASE_URL_PARSE = "";
    process.env.ANTHROPIC_MODEL_PARSE = "";

    expect(getAnthropicConfig("PARSE")).toEqual({
      apiKey: "shared-key",
      baseURL: "https://shared",
      model: "shared-model",
    });
  });

  it("uses default model glm-5.1 when nothing is set", () => {
    expect(getAnthropicConfig("PARSE")).toEqual({
      apiKey: undefined,
      baseURL: undefined,
      model: "glm-5.1",
    });
  });
});
