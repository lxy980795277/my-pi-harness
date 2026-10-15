import anthropic from '@lobehub/icons-static-svg/icons/anthropic.svg';
import deepseek from '@lobehub/icons-static-svg/icons/deepseek-color.svg';
import gemini from '@lobehub/icons-static-svg/icons/gemini-color.svg';
import kimi from '@lobehub/icons-static-svg/icons/kimi-color.svg';
import minimax from '@lobehub/icons-static-svg/icons/minimax-color.svg';
import openai from '@lobehub/icons-static-svg/icons/openai.svg';

/** Only provider-brand assets use the approved static logo collection. */
export const PROVIDER_LOGOS: Readonly<Record<string, string>> = {
  'openai-codex': openai,
  anthropic,
  google: gemini,
  deepseek,
  minimax,
  'kimi-coding': kimi,
};

const MONOCHROME_PROVIDERS = new Set(['openai-codex', 'anthropic']);

/** Monochrome marks invert with the theme while colored vendor assets keep their brand colors. */
export const getProviderLogoClass = (id: string | null): string => {
  if (id !== null && MONOCHROME_PROVIDERS.has(id)) {
    return 'size-[22px] object-contain dark:invert';
  }
  return 'size-[22px] object-contain';
};
