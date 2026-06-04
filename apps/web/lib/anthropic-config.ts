export type AnthropicScenario = "PARSE";

export interface AnthropicConfig {
  apiKey: string | undefined;
  baseURL: string | undefined;
  model: string;
}

const DEFAULT_MODEL = "glm-5.1";

export function getAnthropicConfig(scenario: AnthropicScenario): AnthropicConfig {
  return {
    apiKey:
      process.env[`ANTHROPIC_API_KEY_${scenario}`] ?? process.env.ANTHROPIC_API_KEY,
    baseURL:
      process.env[`ANTHROPIC_BASE_URL_${scenario}`] ?? process.env.ANTHROPIC_BASE_URL,
    model:
      process.env[`ANTHROPIC_MODEL_${scenario}`] ??
      process.env.ANTHROPIC_MODEL ??
      DEFAULT_MODEL,
  };
}
