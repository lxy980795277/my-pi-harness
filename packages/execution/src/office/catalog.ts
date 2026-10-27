import { Type, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { ExecutionError } from '../errors.js';
import type { ToolDescription } from '../types.js';
import { DOCX_PARAMETERS } from './document-schema.js';
import { PDF_PARAMETERS } from './pdf-schema.js';

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
      'Create a DOCX or edit a source into a new output. Supports fonts/styles, page layout, rich paragraphs, headers/footers, staged images, tracked text changes, comments/notes/fields and simple merges. Never overwrites source. Inspect and render before claiming visual quality.',
    parameters: DOCX_PARAMETERS,
  },
  {
    name: 'office_pdf',
    description:
      'Create paginated PDF prose/tables with flow and layout, or produce a new edited copy: pages, text/checkbox/choice fields, bounded flattening/repair and overlays. Overlays are NOT secure redaction. Encrypted, signed, XFA and active PDFs are rejected.',
    parameters: PDF_PARAMETERS,
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
