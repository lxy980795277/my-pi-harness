import type { Provider } from '@earendil-works/pi-ai';
import { RuntimeError } from '../errors.js';

/** Product-supported native providers, loaded through Pi's public factory exports. */
export const BUILTIN_PROVIDER_IDS = [
  'openai-codex',
  'anthropic',
  'google',
  'deepseek',
  'minimax',
  'kimi-coding',
] as const;

const HISTORICAL_PROVIDER_IDS = [
  'openai',
  'xai',
  'github-copilot',
  'openrouter',
  'moonshotai',
  'moonshotai-cn',
  'minimax-cn',
  'qwen-token-plan',
  'qwen-token-plan-cn',
  'zai',
  'zai-coding-cn',
  'xiaomi',
  'xiaomi-token-plan-cn',
  'opencode',
] as const;

/** Recognize persisted factory IDs, including providers removed from the current catalog. */
export function isKnownBuiltinProvider(id: string): boolean {
  return [...BUILTIN_PROVIDER_IDS, ...HISTORICAL_PROVIDER_IDS].some((known) => known === id);
}

/** Load one native factory without importing every provider's HTTP SDK. */
export async function loadBuiltinProvider(id: string): Promise<Provider> {
  switch (id) {
    case 'deepseek':
      return (await import('@earendil-works/pi-ai/providers/deepseek')).deepseekProvider();
    case 'openai':
      return (await import('@earendil-works/pi-ai/providers/openai')).openaiProvider();
    case 'openai-codex':
      return {
        ...(await import('@earendil-works/pi-ai/providers/openai-codex')).openaiCodexProvider(),
        name: 'OpenAI',
      };
    case 'anthropic':
      return (await import('@earendil-works/pi-ai/providers/anthropic')).anthropicProvider();
    case 'google':
      return (await import('@earendil-works/pi-ai/providers/google')).googleProvider();
    case 'xai':
      return (await import('@earendil-works/pi-ai/providers/xai')).xaiProvider();
    case 'github-copilot':
      return (
        await import('@earendil-works/pi-ai/providers/github-copilot')
      ).githubCopilotProvider();
    case 'openrouter':
      return (await import('@earendil-works/pi-ai/providers/openrouter')).openrouterProvider();
    case 'kimi-coding':
      return {
        ...(await import('@earendil-works/pi-ai/providers/kimi-coding')).kimiCodingProvider(),
        name: 'Kimi',
      };
    case 'moonshotai':
      return (await import('@earendil-works/pi-ai/providers/moonshotai')).moonshotaiProvider();
    case 'moonshotai-cn':
      return (await import('@earendil-works/pi-ai/providers/moonshotai-cn')).moonshotaiCnProvider();
    case 'minimax':
      return (await import('@earendil-works/pi-ai/providers/minimax')).minimaxProvider();
    case 'minimax-cn':
      return (await import('@earendil-works/pi-ai/providers/minimax-cn')).minimaxCnProvider();
    case 'qwen-token-plan':
      return (
        await import('@earendil-works/pi-ai/providers/qwen-token-plan')
      ).qwenTokenPlanProvider();
    case 'qwen-token-plan-cn':
      return (
        await import('@earendil-works/pi-ai/providers/qwen-token-plan-cn')
      ).qwenTokenPlanCnProvider();
    case 'zai':
      return (await import('@earendil-works/pi-ai/providers/zai')).zaiProvider();
    case 'zai-coding-cn':
      return (await import('@earendil-works/pi-ai/providers/zai-coding-cn')).zaiCodingCnProvider();
    case 'xiaomi':
      return (await import('@earendil-works/pi-ai/providers/xiaomi')).xiaomiProvider();
    case 'xiaomi-token-plan-cn':
      return (
        await import('@earendil-works/pi-ai/providers/xiaomi-token-plan-cn')
      ).xiaomiTokenPlanCnProvider();
    case 'opencode':
      return (await import('@earendil-works/pi-ai/providers/opencode')).opencodeProvider();
    default:
      throw new RuntimeError('PROVIDER_UNKNOWN', 'Native provider is not supported');
  }
}
