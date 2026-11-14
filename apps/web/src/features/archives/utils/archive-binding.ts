import type { ModelInfo, ThinkingLevel } from '@my-pi-harness/protocol';

const THINKING_ORDER: readonly ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/** Selects a visible valid default from the current model; unsupported off never becomes a request. */
export const archiveBindingThinking = (
  model: ModelInfo | undefined,
  preferred: ThinkingLevel | null,
): ThinkingLevel | null => {
  if (model === undefined) return null;
  if (preferred !== null && model.supportedThinkingLevels.includes(preferred)) return preferred;
  for (const level of THINKING_ORDER)
    if (model.supportedThinkingLevels.includes(level)) return level;
  return null;
};
