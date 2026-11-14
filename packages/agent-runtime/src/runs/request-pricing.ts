import {
  calculateCost,
  PI_AI_VERSION,
  type Api,
  type Model,
  type Usage,
} from '@earendil-works/pi-ai';
import type { ModelRequestCostEstimate } from '@my-pi-harness/protocol';
import type { ModelRequestPriceSnapshot } from '@my-pi-harness/protocol/internal';

/** Freeze only catalog pricing rules; provider headers and custom zero placeholders are excluded. */
export function requestPriceSnapshot(
  model: Model<Api>,
  source: 'pi-catalog' | undefined,
): ModelRequestPriceSnapshot {
  if (source !== 'pi-catalog') return { source: 'unknown' };
  const rates = structuredClone(model.cost);
  const rules = [rates, ...(rates.tiers ?? [])];
  if (
    rules.some((rule) =>
      [rule.input, rule.output, rule.cacheRead, rule.cacheWrite].some(
        (value) => !Number.isFinite(value) || value < 0,
      ),
    ) ||
    rates.tiers?.some(
      (tier) => !Number.isFinite(tier.inputTokensAbove) || tier.inputTokensAbove < 0,
    )
  )
    return { source: 'unknown' };
  return { source: 'pi-catalog', catalogVersion: PI_AI_VERSION, currency: 'USD', rates };
}

/** Apply frozen rules after usage arrives; Pi owns tier and long-cache-write arithmetic. */
export function requestCostEstimate(
  model: Model<Api>,
  snapshot: ModelRequestPriceSnapshot,
  usage: Usage,
): ModelRequestCostEstimate | undefined {
  if (snapshot.source !== 'pi-catalog') return undefined;
  const cost = calculateCost({ ...model, cost: snapshot.rates }, structuredClone(usage));
  if (Object.values(cost).some((value) => !Number.isFinite(value) || value < 0)) return undefined;
  return {
    source: 'pi-catalog',
    catalogVersion: snapshot.catalogVersion,
    currency: 'USD',
    ...cost,
  };
}
