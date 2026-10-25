import { Type, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { ExecutionError } from '../errors.js';
import type { ToolDescription } from '../types.js';

const object = <T extends Record<string, TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const text = Type.String({ maxLength: 20_000 });
const short = Type.String({ minLength: 1, maxLength: 200 });
const path = Type.String({ minLength: 1, maxLength: 2048 });
const index = Type.Integer({ minimum: 0, maximum: 20_000 });
const positive = Type.Integer({ minimum: 1, maximum: 100 });
const cells = Type.Array(
  Type.Array(Type.Union([text, Type.Number(), Type.Boolean(), Type.Null()]), { maxItems: 100 }),
  { maxItems: 200 },
);
const table = object({ rows: cells });
const bounds = {
  x: Type.Number({ minimum: 0, maximum: 30 }),
  y: Type.Number({ minimum: 0, maximum: 30 }),
  width: Type.Number({ minimum: 0.1, maximum: 30 }),
  height: Type.Number({ minimum: 0.1, maximum: 30 }),
};
const chart = object({
  kind: Type.Union([Type.Literal('bar'), Type.Literal('line'), Type.Literal('pie')]),
  title: Type.Optional(short),
  categories: Type.Array(short, { minItems: 1, maxItems: 100 }),
  series: Type.Array(
    object({ name: short, values: Type.Array(Type.Number(), { minItems: 1, maxItems: 100 }) }),
    { minItems: 1, maxItems: 20 },
  ),
});
const docxOperation = Type.Union([
  object({
    kind: Type.Literal('replace_text'),
    old: Type.String({ minLength: 1, maxLength: 20_000 }),
    replacement: text,
  }),
  object({
    kind: Type.Literal('revisions'),
    action: Type.Union([Type.Literal('accept'), Type.Literal('reject')]),
  }),
  object({ kind: Type.Literal('comment_add'), paragraph: index, text, author: short }),
  object({ kind: Type.Literal('comment_remove'), id: index }),
  object({
    kind: Type.Literal('note'),
    paragraph: index,
    text,
    noteType: Type.Union([Type.Literal('footnote'), Type.Literal('endnote')]),
  }),
  object({
    kind: Type.Literal('bookmark'),
    paragraph: index,
    name: Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]{0,39}$' }),
  }),
  object({
    kind: Type.Literal('field'),
    fieldType: Type.Union([Type.Literal('toc'), Type.Literal('ref'), Type.Literal('caption')]),
    target: Type.Optional(short),
    text: Type.Optional(text),
  }),
  object({ kind: Type.Literal('content_control'), tag: short, text }),
  object({
    kind: Type.Literal('metadata'),
    title: Type.Optional(text),
    subject: Type.Optional(text),
    creator: Type.Optional(short),
    description: Type.Optional(text),
  }),
]);
const format = Type.Union([
  Type.Literal('docx'),
  Type.Literal('pdf'),
  Type.Literal('xlsx'),
  Type.Literal('pptx'),
]);

/** Fixed, structured tools; no supplied source code or program name reaches the worker. */
export const OFFICE_TOOL_DEFINITIONS: readonly {
  name: string;
  description: string;
  parameters: TSchema;
}[] = [
  {
    name: 'office_inspect',
    description:
      'Inspect a workspace DOCX/PDF/XLSX/PPTX: bounded text, structure, fields, charts, formula caches and validation. Does not calculate formulas or OCR.',
    parameters: object({ source: path }),
  },
  {
    name: 'office_docx',
    description:
      'Create a DOCX or edit a source into a new output. Supports bounded plain text changes, simple revisions, comments, notes, bookmarks, fields, content controls and simple merges. Never overwrites source. Inspect and render before claiming visual quality.',
    parameters: object({
      source: Type.Optional(path),
      output: path,
      paragraphs: Type.Optional(
        Type.Array(
          object({ text, heading: Type.Optional(Type.Integer({ minimum: 0, maximum: 6 })) }),
          { maxItems: 200 },
        ),
      ),
      tables: Type.Optional(Type.Array(table, { maxItems: 20 })),
      operations: Type.Optional(Type.Array(docxOperation, { maxItems: 100 })),
      mergeSources: Type.Optional(Type.Array(path, { minItems: 1, maxItems: 10 })),
    }),
  },
  {
    name: 'office_pdf',
    description:
      'Create PDF or produce a new copy with selected/reordered/rotated/appended pages, text/checkbox field filling, bounded flattening, restricted field-tree repair and text/white overlays. Overlays are NOT secure redaction. Encrypted, signed, XFA and active PDFs are rejected.',
    parameters: object({
      source: Type.Optional(path),
      output: path,
      pages: Type.Optional(
        Type.Array(
          object({
            text,
            tables: Type.Optional(Type.Array(table, { maxItems: 10 })),
            width: Type.Optional(Type.Number({ minimum: 72, maximum: 1440 })),
            height: Type.Optional(Type.Number({ minimum: 72, maximum: 1440 })),
          }),
          { minItems: 1, maxItems: 100 },
        ),
      ),
      selectPages: Type.Optional(Type.Array(positive, { minItems: 1, maxItems: 100 })),
      rotations: Type.Optional(
        Type.Array(
          object({
            page: positive,
            degrees: Type.Union([Type.Literal(90), Type.Literal(180), Type.Literal(270)]),
          }),
          { maxItems: 100 },
        ),
      ),
      appendSources: Type.Optional(Type.Array(path, { maxItems: 10 })),
      fields: Type.Optional(
        Type.Record(
          Type.String({ minLength: 1, maxLength: 200 }),
          Type.Union([text, Type.Boolean()]),
        ),
      ),
      flatten: Type.Optional(Type.Boolean()),
      repairFields: Type.Optional(Type.Boolean()),
      overlays: Type.Optional(
        Type.Array(
          object({
            page: positive,
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
    }),
  },
  {
    name: 'office_xlsx',
    description:
      'Create or edit a source workbook into a new XLSX: cells/formulas/styles/tables/charts. Macros and external links rejected. Formulas are stored but NOT calculated; inspect reports missing formula caches and error cells.',
    parameters: object({
      source: Type.Optional(path),
      output: path,
      sheets: Type.Array(
        object({
          name: Type.String({ minLength: 1, maxLength: 31 }),
          rows: Type.Optional(cells),
          startCell: Type.Optional(Type.String({ pattern: '^[A-Z]{1,3}[1-9][0-9]{0,5}$' })),
          cells: Type.Optional(
            Type.Array(
              object({
                cell: Type.String({ pattern: '^[A-Z]{1,3}[1-9][0-9]{0,5}$' }),
                value: Type.Union([text, Type.Number(), Type.Boolean(), Type.Null()]),
                bold: Type.Optional(Type.Boolean()),
                numberFormat: Type.Optional(short),
                fill: Type.Optional(Type.String({ pattern: '^[A-Fa-f0-9]{6}$' })),
                fontSize: Type.Optional(Type.Integer({ minimum: 6, maximum: 72 })),
              }),
              { maxItems: 2000 },
            ),
          ),
          tables: Type.Optional(
            Type.Array(
              object({
                name: Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]{0,100}$' }),
                range: Type.String({
                  pattern: '^[A-Z]{1,3}[1-9][0-9]{0,5}:[A-Z]{1,3}[1-9][0-9]{0,5}$',
                }),
              }),
              { maxItems: 20 },
            ),
          ),
          charts: Type.Optional(
            Type.Array(
              object({ chart, anchor: Type.String({ pattern: '^[A-Z]{1,3}[1-9][0-9]{0,5}$' }) }),
              { maxItems: 20 },
            ),
          ),
        }),
        { minItems: 1, maxItems: 20 },
      ),
    }),
  },
  {
    name: 'office_pptx',
    description:
      'Create a presentation or edit a template into a new PPTX while preserving original slide dimensions/layout parts. Add native text/table/chart shapes or change existing text/table/chart data by zero-based slide/shape index. Rejects overflow and empty chart series.',
    parameters: object({
      source: Type.Optional(path),
      output: path,
      width: Type.Optional(Type.Number({ minimum: 1, maximum: 30 })),
      height: Type.Optional(Type.Number({ minimum: 1, maximum: 30 })),
      slides: Type.Optional(
        Type.Array(
          object({
            layout: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
            shapes: Type.Array(
              Type.Union([
                object({
                  kind: Type.Literal('text'),
                  ...bounds,
                  text,
                  fontSize: Type.Optional(Type.Integer({ minimum: 6, maximum: 96 })),
                }),
                object({ kind: Type.Literal('table'), ...bounds, rows: cells }),
                object({ kind: Type.Literal('chart'), ...bounds, chart }),
              ]),
              { maxItems: 100 },
            ),
          }),
          { maxItems: 100 },
        ),
      ),
      edits: Type.Optional(
        Type.Array(
          Type.Union([
            object({ slide: index, shape: index, kind: Type.Literal('text'), text }),
            object({
              slide: index,
              shape: index,
              kind: Type.Literal('table_cell'),
              row: index,
              column: index,
              text,
            }),
            object({ slide: index, shape: index, kind: Type.Literal('chart'), chart }),
          ]),
          { maxItems: 200 },
        ),
      ),
    }),
  },
  {
    name: 'pdf_read_pages',
    description:
      'Render 1–4 selected PDF pages as real PNG images for a vision-capable model. Does not OCR. Page numbers are one-based; encrypted/signed/active PDF rejected.',
    parameters: object({
      source: path,
      pages: Type.Array(positive, { minItems: 1, maxItems: 4 }),
      maxPixels: Type.Optional(Type.Integer({ minimum: 256, maximum: 2000 })),
    }),
  },
  {
    name: 'office_render',
    description:
      'Render DOCX/XLSX/PPTX to a NEW PDF using an already installed LibreOffice. Missing dependency fails explicitly; never downloads software. Inspect the output with pdf_read_pages before claiming visual quality.',
    parameters: object({ source: path, output: path }),
  },
];

export function validateOfficeArguments(name: string, args: Record<string, unknown>): void {
  const definition = OFFICE_TOOL_DEFINITIONS.find((entry) => entry.name === name);
  if (!definition) throw new ExecutionError('UNKNOWN_TOOL', 'The office tool is not available');
  if (!Value.Check(definition.parameters, args))
    throw new ExecutionError('INVALID_ARGUMENTS', `Invalid arguments for ${name}`);
}

/** Every office mutation or converter is approved before its owned process starts. */
export function describeOfficeTool(name: string, args: Record<string, unknown>): ToolDescription {
  validateOfficeArguments(name, args);
  const mutating = name !== 'office_inspect' && name !== 'pdf_read_pages';
  const target = args['output'] ?? args['source'];
  return {
    summary: `${name}: ${String(target).slice(0, 300)}`,
    approvalRequired: mutating,
    mutating,
  };
}

export const OFFICE_FORMAT_SCHEMA = format;
