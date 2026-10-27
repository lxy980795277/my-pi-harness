import { Type, type TSchema } from 'typebox';

const object = <T extends Record<string, TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const text = Type.String({ maxLength: 20_000 });
const path = Type.String({ minLength: 1, maxLength: 2048 });
const page = Type.Integer({ minimum: 1, maximum: 100 });
const rows = Type.Array(
  Type.Array(
    Type.Union([Type.String({ maxLength: 2000 }), Type.Number(), Type.Boolean(), Type.Null()]),
    { minItems: 1, maxItems: 20 },
  ),
  { minItems: 1, maxItems: 500 },
);
const alignment = Type.Union([
  Type.Literal('left'),
  Type.Literal('center'),
  Type.Literal('right'),
  Type.Literal('justify'),
]);
const fontName = Type.Union([
  Type.Literal('STSong-Light'),
  Type.Literal('Helvetica'),
  Type.Literal('Times-Roman'),
  Type.Literal('Courier'),
]);
const flowStyle = {
  fontSize: Type.Optional(Type.Number({ minimum: 6, maximum: 48 })),
  lineSpacing: Type.Optional(Type.Number({ minimum: 1, maximum: 3 })),
  alignment: Type.Optional(alignment),
  spaceAfter: Type.Optional(Type.Number({ minimum: 0, maximum: 72 })),
};

/** Flow layout paginates plain text and tables; fields accept only known text, checkbox and choice values. */
export const PDF_PARAMETERS = object({
  source: Type.Optional(path),
  output: path,
  pages: Type.Optional(
    Type.Array(
      object({
        text,
        tables: Type.Optional(Type.Array(object({ rows }), { maxItems: 10 })),
        width: Type.Optional(Type.Number({ minimum: 72, maximum: 1440 })),
        height: Type.Optional(Type.Number({ minimum: 72, maximum: 1440 })),
      }),
      { minItems: 1, maxItems: 100 },
    ),
  ),
  layout: Type.Optional(
    object({
      width: Type.Optional(Type.Number({ minimum: 144, maximum: 1440 })),
      height: Type.Optional(Type.Number({ minimum: 144, maximum: 1440 })),
      margins: Type.Optional(
        object({
          top: Type.Number({ minimum: 18, maximum: 144 }),
          right: Type.Number({ minimum: 18, maximum: 144 }),
          bottom: Type.Number({ minimum: 18, maximum: 144 }),
          left: Type.Number({ minimum: 18, maximum: 144 }),
        }),
      ),
      font: Type.Optional(fontName),
      fontSize: Type.Optional(Type.Number({ minimum: 6, maximum: 24 })),
      lineSpacing: Type.Optional(Type.Number({ minimum: 1, maximum: 3 })),
      header: Type.Optional(Type.String({ maxLength: 200 })),
      footer: Type.Optional(Type.String({ maxLength: 200 })),
      pageNumbers: Type.Optional(Type.Boolean()),
    }),
  ),
  flow: Type.Optional(
    Type.Array(
      Type.Union([
        object({ kind: Type.Literal('paragraph'), text, ...flowStyle }),
        object({
          kind: Type.Literal('heading'),
          text,
          level: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })),
          ...flowStyle,
        }),
        object({
          kind: Type.Literal('table'),
          rows,
          headerRows: Type.Optional(Type.Integer({ minimum: 0, maximum: 3 })),
          columnWidths: Type.Optional(
            Type.Array(Type.Number({ minimum: 18, maximum: 1000 }), { minItems: 1, maxItems: 20 }),
          ),
          ...flowStyle,
        }),
        object({ kind: Type.Literal('page_break') }),
      ]),
      { minItems: 1, maxItems: 300 },
    ),
  ),
  selectPages: Type.Optional(Type.Array(page, { minItems: 1, maxItems: 100 })),
  rotations: Type.Optional(
    Type.Array(
      object({
        page,
        degrees: Type.Union([Type.Literal(90), Type.Literal(180), Type.Literal(270)]),
      }),
      { maxItems: 100 },
    ),
  ),
  appendSources: Type.Optional(Type.Array(path, { maxItems: 10 })),
  fields: Type.Optional(
    Type.Record(
      Type.String({ minLength: 1, maxLength: 200 }),
      Type.Union([
        text,
        Type.Boolean(),
        Type.Array(Type.String({ maxLength: 2000 }), { minItems: 1, maxItems: 100 }),
      ]),
    ),
  ),
  flatten: Type.Optional(Type.Boolean()),
  repairFields: Type.Optional(Type.Boolean()),
  overlays: Type.Optional(
    Type.Array(
      object({
        page,
        x: Type.Number({ minimum: 0 }),
        y: Type.Number({ minimum: 0 }),
        width: Type.Number({ minimum: 1, maximum: 1440 }),
        height: Type.Number({ minimum: 1, maximum: 1440 }),
        text: Type.Optional(text),
        cover: Type.Optional(Type.Boolean()),
      }),
      { maxItems: 100 },
    ),
  ),
});
