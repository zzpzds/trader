export type AnthropicScenario = "NEWS" | "MONITORING";
export interface AnthropicConfig {
    apiKey: string | undefined;
    baseURL: string | undefined;
    model: string;
}
export declare function getAnthropicConfig(scenario: AnthropicScenario): AnthropicConfig;
