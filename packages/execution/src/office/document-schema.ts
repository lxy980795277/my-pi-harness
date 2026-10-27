import { Type } from 'typebox';
import { strictObjectSchema } from '../core/schema.js';

const text = Type.String({ maxLength: 20_000 });
const name = Type.String({ minLength: 1, maxLength: 80 });
const path = Type.String({ minLength: 1, maxLength: 2048 });
const index = Type.Integer({ minimum: 0, maximum: 20_000 });
const points = Type.Number({ minimum: 0, maximum: 144 });
const alignment = Type.Union([
  Type.Literal('left'),
  Type.Literal('center'),
  Type.Literal('right'),
  Type.Literal('justify'),
]);
const font = strictObjectSchema({
  name: Type.Optional(name),
  size: Type.Optional(Type.Number({ minimum: 6, maximum: 72, multipleOf: 0.5 })),
  color: Type.Optional(Type.String({ pattern: '^[A-Fa-f0-9]{6}$' })),
  bold: Type.Optional(Type.Boolean()),
  italic: Type.Optional(Type.Boolean()),
  underline: Type.Optional(Type.Boolean()),
});
const paragraphFormat = strictObjectSchema({
  alignment: Type.Optional(alignment),
  spaceBefore: Type.Optional(points),
  spaceAfter: Type.Optional(points),
  lineSpacing: Type.Optional(Type.Number({ minimum: 1, maximum: 3 })),
  leftIndent: Type.Optional(points),
  rightIndent: Type.Optional(points),
  firstLineIndent: Type.Optional(Type.Number({ minimum: -72, maximum: 144 })),
  keepWithNext: Type.Optional(Type.Boolean()),
  keepTogether: Type.Optional(Type.Boolean()),
  pageBreakBefore: Type.Optional(Type.Boolean()),
});
const paragraph = strictObjectSchema({
  text: Type.Optional(text),
  runs: Type.Optional(
    Type.Array(strictObjectSchema({ text, font: Type.Optional(font) }), {
      minItems: 1,
      maxItems: 100,
    }),
  ),
  heading: Type.Optional(Type.Integer({ minimum: 0, maximum: 6 })),
  style: Type.Optional(name),
  font: Type.Optional(font),
  format: Type.Optional(paragraphFormat),
});
const table = strictObjectSchema({
  rows: Type.Array(
    Type.Array(Type.Union([text, Type.Number(), Type.Boolean(), Type.Null()]), { maxItems: 100 }),
    { maxItems: 200 },
  ),
  headerRows: Type.Optional(Type.Integer({ minimum: 0, maximum: 3 })),
  style: Type.Optional(name),
});
const headerFooter = strictObjectSchema({
  text,
  font: Type.Optional(font),
  alignment: Type.Optional(alignment),
  pageNumber: Type.Optional(Type.Boolean()),
});

/** Bounded DOCX authoring and edits; all dimensions are points and images are staged workspace files. */
export const DOCX_PARAMETERS = strictObjectSchema({
  source: Type.Optional(path),
  output: path,
  layout: Type.Optional(
    strictObjectSchema({
      width: Type.Optional(Type.Number({ minimum: 144, maximum: 1440 })),
      height: Type.Optional(Type.Number({ minimum: 144, maximum: 1440 })),
      margins: Type.Optional(
        strictObjectSchema({ top: points, right: points, bottom: points, left: points }),
      ),
      headerDistance: Type.Optional(points),
      footerDistance: Type.Optional(points),
    }),
  ),
  defaultFont: Type.Optional(font),
  styles: Type.Optional(
    Type.Array(
      strictObjectSchema({
        name,
        basedOn: Type.Optional(name),
        font: Type.Optional(font),
        format: Type.Optional(paragraphFormat),
      }),
      { maxItems: 30 },
    ),
  ),
  header: Type.Optional(headerFooter),
  footer: Type.Optional(headerFooter),
  paragraphs: Type.Optional(Type.Array(paragraph, { maxItems: 200 })),
  tables: Type.Optional(Type.Array(table, { maxItems: 20 })),
  images: Type.Optional(
    Type.Array(
      strictObjectSchema({
        source: path,
        width: Type.Number({ minimum: 1, maximum: 1000 }),
        height: Type.Optional(Type.Number({ minimum: 1, maximum: 1000 })),
        altText: name,
        alignment: Type.Optional(alignment),
      }),
      { maxItems: 20 },
    ),
  ),
  operations: Type.Optional(
    Type.Array(
      Type.Union([
        strictObjectSchema({
          kind: Type.Literal('replace_text'),
          old: Type.String({ minLength: 1, maxLength: 20_000 }),
          replacement: text,
        }),
        strictObjectSchema({
          kind: Type.Literal('tracked_replace'),
          old: Type.String({ minLength: 1, maxLength: 20_000 }),
          replacement: text,
          author: name,
        }),
        strictObjectSchema({
          kind: Type.Literal('format_paragraph'),
          paragraph: index,
          style: Type.Optional(name),
          font: Type.Optional(font),
          format: Type.Optional(paragraphFormat),
        }),
        strictObjectSchema({
          kind: Type.Literal('revisions'),
          action: Type.Union([Type.Literal('accept'), Type.Literal('reject')]),
        }),
        strictObjectSchema({
          kind: Type.Literal('comment_add'),
          paragraph: index,
          text,
          author: name,
        }),
        strictObjectSchema({ kind: Type.Literal('comment_remove'), id: index }),
        strictObjectSchema({
          kind: Type.Literal('note'),
          paragraph: index,
          text,
          noteType: Type.Union([Type.Literal('footnote'), Type.Literal('endnote')]),
        }),
        strictObjectSchema({
          kind: Type.Literal('bookmark'),
          paragraph: index,
          name: Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]{0,39}$' }),
        }),
        strictObjectSchema({
          kind: Type.Literal('field'),
          fieldType: Type.Union([
            Type.Literal('toc'),
            Type.Literal('ref'),
            Type.Literal('caption'),
          ]),
          target: Type.Optional(name),
          text: Type.Optional(text),
        }),
        strictObjectSchema({ kind: Type.Literal('content_control'), tag: name, text }),
        strictObjectSchema({
          kind: Type.Literal('metadata'),
          title: Type.Optional(text),
          subject: Type.Optional(text),
          creator: Type.Optional(name),
          description: Type.Optional(text),
        }),
      ]),
      { maxItems: 100 },
    ),
  ),
  mergeSources: Type.Optional(Type.Array(path, { minItems: 1, maxItems: 10 })),
});
