import { Type, type Static } from 'typebox';
import { ModelRequestPurposeSchema } from '../sessions/trace';
import { MessageUsageSchema } from '../sessions/sessions';
import { ModelRequestCostEstimateSchema } from '../sessions/trace';

export type ModelRequestStarted = Static<typeof ModelRequestStartedSchema>;
export type ModelRequestCompleted = Static<typeof ModelRequestCompletedSchema>;
export type ModelRequestPriceSnapshot = Static<typeof ModelRequestPriceSnapshotSchema>;
export type ModelRequestStartedPrivate = Static<typeof ModelRequestStartedPrivateSchema>;

const id = Type.String({ minLength: 1, maxLength: 160 });
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const rates = {
  input: Type.Number({ minimum: 0 }),
  output: Type.Number({ minimum: 0 }),
  cacheRead: Type.Number({ minimum: 0 }),
  cacheWrite: Type.Number({ minimum: 0 }),
};

/** Immutable request-time catalogue rules, including all tiers needed after usage settles. */
export const ModelRequestPriceSnapshotSchema = Type.Union([
  Type.Object({ source: Type.Literal('unknown') }, { additionalProperties: false }),
  Type.Object(
    {
      source: Type.Literal('pi-catalog'),
      catalogVersion: Type.String({ minLength: 1, maxLength: 100 }),
      currency: Type.Literal('USD'),
      rates: Type.Object(
        {
          ...rates,
          tiers: Type.Optional(
            Type.Array(
              Type.Object(
                { ...rates, inputTokensAbove: Type.Number({ minimum: 0 }) },
                { additionalProperties: false },
              ),
              { maxItems: 128 },
            ),
          ),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
]);
export const ModelRequestStartedPrivateSchema = Type.Object(
  { priceSnapshot: ModelRequestPriceSnapshotSchema },
  { additionalProperties: false },
);

/** Written immediately before one actual stream invocation; input ownership is frozen here. */
export const ModelRequestStartedSchema = Type.Object(
  {
    modelRequestId: id,
    branchId: id,
    purpose: ModelRequestPurposeSchema,
    inputMessageId: Type.Union([id, Type.Null()]),
    answerInputMessageId: Type.Optional(Type.Union([id, Type.Null()])),
    providerId: id,
    modelId: id,
    queuedAt: count,
    queueDurationMs: Type.Optional(count),
    startedAt: count,
  },
  { additionalProperties: false },
);
/** The provider's actual terminal result, including errors represented by a resolved SDK result. */
export const ModelRequestCompletedSchema = Type.Object(
  {
    modelRequestId: id,
    status: Type.Union([
      Type.Literal('completed'),
      Type.Literal('failed'),
      Type.Literal('cancelled'),
    ]),
    finishedAt: count,
    durationMs: count,
    firstResponseMs: Type.Union([count, Type.Null()]),
    usage: Type.Optional(MessageUsageSchema),
    error: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    responseId: Type.Optional(id),
    costEstimate: Type.Optional(ModelRequestCostEstimateSchema),
    cacheWrite1h: Type.Optional(count),
  },
  { additionalProperties: false },
);
