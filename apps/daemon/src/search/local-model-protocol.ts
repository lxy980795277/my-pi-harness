import { Type, type Static } from 'typebox';
import { LOCAL_EMBEDDING_MODEL } from './embedding-model';

export type LocalModelReply = Static<typeof LocalModelReplySchema>;
export type LocalModelKind = 'embedding' | 'reranker';
export type LocalModelOperation = 'prepare' | 'embed' | 'tokens' | 'rerank';
export type EmbeddingKind = 'query' | 'passage';
export type LocalModelPriority = 'foreground' | 'tool' | 'background';

export const EMBEDDING_BATCH_SIZE = 16;
export const EMBEDDING_BACKGROUND_BATCH_SIZE = 4;
export const RERANK_BATCH_SIZE = 4;

const id = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const ready = Type.Boolean();
const vectors = Type.Array(
  Type.Array(Type.Number(), {
    minItems: LOCAL_EMBEDDING_MODEL.dimensions,
    maxItems: LOCAL_EMBEDDING_MODEL.dimensions,
  }),
  { maxItems: EMBEDDING_BATCH_SIZE },
);
const counts = Type.Array(Type.Integer({ minimum: 0, maximum: 1_000_000 }), {
  maxItems: EMBEDDING_BATCH_SIZE,
});
const scores = Type.Array(Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()]), {
  maxItems: RERANK_BATCH_SIZE,
});

/** Each dispatched operation settles once; readiness belongs to its target model. */
export const LocalModelReplySchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal('progress'),
      id,
      loadedBytes: Type.Integer({ minimum: 0 }),
      totalBytes: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal('settled'), id, status: Type.Literal('prepared'), ready },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal('settled'), id, status: Type.Literal('vectors'), ready, vectors },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal('settled'), id, status: Type.Literal('tokens'), ready, counts },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal('settled'), id, status: Type.Literal('scores'), ready, scores },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal('settled'), id, status: Type.Literal('cancelled'), ready },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('settled'),
      id,
      status: Type.Literal('error'),
      ready,
      error: Type.Union([
        Type.Literal('UNPREPARED'),
        Type.Literal('TOKEN_LIMIT'),
        Type.Literal('UNAVAILABLE'),
      ]),
    },
    { additionalProperties: false },
  ),
]);
