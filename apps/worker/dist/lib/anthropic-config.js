const DEFAULT_MODEL = "glm-5.1";
export function getAnthropicConfig(scenario) {
    // Use `||` (not `??`) because docker-compose passes unset overrides as
    // empty strings via `${VAR:-}`. Empty string must fall through to the
    // shared default, not be treated as "set to empty".
    return {
        apiKey: process.env[`ANTHROPIC_API_KEY_${scenario}`] || process.env.ANTHROPIC_API_KEY || undefined,
        baseURL: process.env[`ANTHROPIC_BASE_URL_${scenario}`] || process.env.ANTHROPIC_BASE_URL || undefined,
        model: process.env[`ANTHROPIC_MODEL_${scenario}`] ||
            process.env.ANTHROPIC_MODEL ||
            DEFAULT_MODEL,
    };
}
