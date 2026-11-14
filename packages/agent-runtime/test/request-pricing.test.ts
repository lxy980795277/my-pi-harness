import { fauxProvider, type Usage } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { requestCostEstimate, requestPriceSnapshot } from '../src/runs/request-pricing';

const usage: Usage = {
  input: 80,
  output: 10,
  cacheRead: 20,
  cacheWrite: 30,
  cacheWrite1h: 10,
  totalTokens: 140,
  cost: { input: 999, output: 999, cacheRead: 999, cacheWrite: 999, total: 3996 },
};

function pricedModel() {
  return {
    ...fauxProvider().models[0],
    headers: { Authorization: 'Bearer private-header-do-not-store' },
    cost: {
      input: 1,
      output: 2,
      cacheRead: 0.25,
      cacheWrite: 1.25,
      tiers: [
        { inputTokensAbove: 1000, input: 9, output: 18, cacheRead: 2.25, cacheWrite: 11.25 },
        { inputTokensAbove: 100, input: 3, output: 6, cacheRead: 0.75, cacheWrite: 3.75 },
      ],
    },
  };
}

describe('request-time catalog estimates', () => {
  it('requires explicit catalog provenance and treats custom zero placeholders as unknown', () => {
    const model = { ...pricedModel(), cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const snapshot = requestPriceSnapshot(model, undefined);
    expect(snapshot).toEqual({ source: 'unknown' });
    expect(requestCostEstimate(model, snapshot, usage)).toBeUndefined();
    const known = requestPriceSnapshot(model, 'pi-catalog');
    expect(requestCostEstimate(model, known, usage)).toMatchObject({
      source: 'pi-catalog',
      currency: 'USD',
      total: 0,
    });
  });

  it('freezes all tiers and prices after actual usage without mutating the SDK result', () => {
    const model = pricedModel();
    const snapshot = requestPriceSnapshot(model, 'pi-catalog');
    model.cost.input = 1000;
    for (const tier of model.cost.tiers) tier.input = 1000;
    const estimate = requestCostEstimate(model, snapshot, usage);
    expect(estimate).toMatchObject({ source: 'pi-catalog', currency: 'USD' });
    expect(estimate?.input).toBeCloseTo(0.00024, 12);
    expect(estimate?.output).toBeCloseTo(0.00006, 12);
    expect(estimate?.cacheRead).toBeCloseTo(0.000015, 12);
    expect(estimate?.cacheWrite).toBeCloseTo(0.000135, 12);
    expect(estimate?.total).toBeCloseTo(0.00045, 12);
    expect(usage.cost.total).toBe(3996);
    expect(JSON.stringify(snapshot)).not.toContain('private-header-do-not-store');
  });

  it('retains lower rates at the exact tier boundary and marks invalid catalog arithmetic unknown', () => {
    const model = pricedModel();
    const snapshot = requestPriceSnapshot(model, 'pi-catalog');
    const boundary: Usage = { ...usage, input: 50, cacheRead: 20, cacheWrite: 30 };
    expect(requestCostEstimate(model, snapshot, boundary)?.input).toBeCloseTo(0.00005, 12);
    model.cost.output = Number.NaN;
    expect(requestPriceSnapshot(model, 'pi-catalog')).toEqual({ source: 'unknown' });
  });
});
