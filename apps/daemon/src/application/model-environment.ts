// Pi 1.1 delegates these constructor defaults to its installed OpenAI and Anthropic SDKs.
const SDK_ENVIRONMENT_KEYS = new Set([
  'OPENAI_API_KEY',
  'OPENAI_ADMIN_KEY',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT_ID',
  'OPENAI_BASE_URL',
  'OPENAI_CUSTOM_HEADERS',
  'OPENAI_WEBHOOK_SECRET',
  'OPENAI_LOG',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_WEBHOOK_SIGNING_KEY',
  'ANTHROPIC_LOG',
]);

/**
 * Remove SDK ambient authentication, routing, headers and console logging once at daemon startup.
 * @param environment The owned process environment, or an isolated record in unit tests.
 */
export function clearAmbientModelEnvironment(environment: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(environment)) {
    if (SDK_ENVIRONMENT_KEYS.has(key.toUpperCase())) delete environment[key];
  }
}
