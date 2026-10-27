import { Type, type Static } from 'typebox';

export type OfficeArtifact = Static<typeof OfficeArtifactSchema>;

/** A newly published workspace artifact; no host paths or image bytes enter public events. */
export const OfficeArtifactSchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 2048 }),
    format: Type.Union([
      Type.Literal('docx'),
      Type.Literal('pdf'),
      Type.Literal('xlsx'),
      Type.Literal('pptx'),
    ]),
    bytes: Type.Integer({ minimum: 1, maximum: 33_554_432 }),
    sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    validation: Type.Array(Type.String({ maxLength: 2000 }), { maxItems: 100 }),
    notVerified: Type.Array(Type.String({ maxLength: 2000 }), { maxItems: 100 }),
  },
  { additionalProperties: false },
);
