import { Type, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import type { ConnectionServiceId } from '@my-pi-harness/protocol';

export type ConnectionMethod = 'GET' | 'POST' | 'PATCH' | 'PUT';
export interface GatewayRequest {
  url: URL;
  method: ConnectionMethod;
  body?: string;
}
export interface ConnectionOperation {
  id: string;
  serviceId: ConnectionServiceId;
  app: string;
  name: string;
  readOnly: boolean;
  description: string;
  parameters: TSchema;
  request(args: Record<string, unknown>): GatewayRequest;
}
const object = <T extends Record<string, TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const resourceId = Type.String({ pattern: '^[A-Za-z0-9_-]{1,200}$' });
const repoId = Type.String({ pattern: '^[A-Za-z0-9_.-]{1,100}$' });
const short = Type.String({ maxLength: 1000 });
const pageSize = Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }));
const body = Type.Record(Type.String({ maxLength: 200 }), Type.Unknown(), { maxProperties: 100 });
function text(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value === '.' || value === '..')
    throw new Error('Invalid operation parameter');
  return encodeURIComponent(value);
}
function endpoint(
  origin: string,
  path: string,
  args: Record<string, unknown>,
  query: readonly string[],
): URL {
  const url = new URL(path, origin);
  for (const key of query) {
    const value = args[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      url.searchParams.set(key, String(value));
    else if (value !== undefined) throw new Error('Unsupported gateway query parameter');
  }
  return url;
}
function operation(
  id: string,
  serviceId: ConnectionServiceId,
  app: string,
  name: string,
  readOnly: boolean,
  method: ConnectionMethod,
  parameters: TSchema,
  url: (args: Record<string, unknown>) => URL,
  hasBody = false,
): ConnectionOperation {
  return {
    id,
    serviceId,
    app,
    name,
    readOnly,
    description: `${name}; fixed ${method} operation, bounded JSON only.`,
    parameters,
    request(args) {
      if (!Value.Check(parameters, args)) throw new Error('Invalid gateway operation arguments');
      const target = url(args);
      const value = { url: target, method };
      if (!hasBody) return value;
      const encoded = JSON.stringify(args['body']);
      if (Buffer.byteLength(encoded) > 250_000)
        throw new Error('Gateway request body exceeds limit');
      return { ...value, body: encoded };
    },
  };
}
const none = object({});
const githubRepo = { owner: repoId, repo: repoId };
const googleDocument = { documentId: resourceId };
const googleSpreadsheet = { spreadsheetId: resourceId };
const googlePresentation = { presentationId: resourceId };
const calendar = { calendarId: Type.String({ minLength: 1, maxLength: 200 }) };

/** Finite REST gateway operations; URL, method and authentication are never model-controlled. */
export const CONNECTION_OPERATIONS: readonly ConnectionOperation[] = [
  operation('service_github_user', 'github', 'GitHub', '读取当前用户', true, 'GET', none, (a) =>
    endpoint('https://api.github.com', '/user', a, []),
  ),
  operation(
    'service_github_repos',
    'github',
    'GitHub',
    '列出仓库',
    true,
    'GET',
    object({
      per_page: pageSize,
      page: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
    }),
    (a) => endpoint('https://api.github.com', '/user/repos', a, ['per_page', 'page']),
  ),
  operation(
    'service_github_issues',
    'github',
    'GitHub',
    '列出Issue',
    true,
    'GET',
    object({ ...githubRepo, per_page: pageSize }),
    (a) =>
      endpoint(
        'https://api.github.com',
        `/repos/${text(a, 'owner')}/${text(a, 'repo')}/issues`,
        a,
        ['per_page'],
      ),
  ),
  operation(
    'service_github_issue_create',
    'github',
    'GitHub',
    '创建Issue',
    false,
    'POST',
    object({
      ...githubRepo,
      body: object({
        title: Type.String({ minLength: 1, maxLength: 256 }),
        body: Type.Optional(Type.String({ maxLength: 50_000 })),
      }),
    }),
    (a) =>
      endpoint(
        'https://api.github.com',
        `/repos/${text(a, 'owner')}/${text(a, 'repo')}/issues`,
        a,
        [],
      ),
    true,
  ),
  operation(
    'service_google_drive_list',
    'google',
    'Drive',
    '列出Drive文件',
    true,
    'GET',
    object({ pageSize, pageToken: Type.Optional(short), q: Type.Optional(short) }),
    (a) =>
      endpoint('https://www.googleapis.com', '/drive/v3/files', a, ['pageSize', 'pageToken', 'q']),
  ),
  operation(
    'service_google_drive_get',
    'google',
    'Drive',
    '读取Drive文件元数据',
    true,
    'GET',
    object({ fileId: resourceId }),
    (a) => endpoint('https://www.googleapis.com', `/drive/v3/files/${text(a, 'fileId')}`, a, []),
  ),
  operation(
    'service_google_docs_get',
    'google',
    'Docs',
    '读取Google文档',
    true,
    'GET',
    object(googleDocument),
    (a) => endpoint('https://docs.googleapis.com', `/v1/documents/${text(a, 'documentId')}`, a, []),
  ),
  operation(
    'service_google_docs_create',
    'google',
    'Docs',
    '创建Google文档',
    false,
    'POST',
    object({ body: object({ title: Type.String({ minLength: 1, maxLength: 256 }) }) }),
    (a) => endpoint('https://docs.googleapis.com', '/v1/documents', a, []),
    true,
  ),
  operation(
    'service_google_docs_update',
    'google',
    'Docs',
    '更新Google文档',
    false,
    'POST',
    object({
      ...googleDocument,
      body: object({
        requests: Type.Array(body, { minItems: 1, maxItems: 100 }),
        writeControl: Type.Optional(body),
      }),
    }),
    (a) =>
      endpoint(
        'https://docs.googleapis.com',
        `/v1/documents/${text(a, 'documentId')}:batchUpdate`,
        a,
        [],
      ),
    true,
  ),
  operation(
    'service_google_sheets_get',
    'google',
    'Sheets',
    '读取工作簿结构',
    true,
    'GET',
    object(googleSpreadsheet),
    (a) =>
      endpoint(
        'https://sheets.googleapis.com',
        `/v4/spreadsheets/${text(a, 'spreadsheetId')}`,
        a,
        [],
      ),
  ),
  operation(
    'service_google_sheets_values',
    'google',
    'Sheets',
    '读取单元格',
    true,
    'GET',
    object({ ...googleSpreadsheet, range: Type.String({ minLength: 1, maxLength: 200 }) }),
    (a) =>
      endpoint(
        'https://sheets.googleapis.com',
        `/v4/spreadsheets/${text(a, 'spreadsheetId')}/values/${text(a, 'range')}`,
        a,
        [],
      ),
  ),
  operation(
    'service_google_sheets_update',
    'google',
    'Sheets',
    '更新单元格',
    false,
    'PUT',
    object({
      ...googleSpreadsheet,
      range: Type.String({ minLength: 1, maxLength: 200 }),
      body: object({
        values: Type.Array(
          Type.Array(
            Type.Union([
              Type.String({ maxLength: 10000 }),
              Type.Number(),
              Type.Boolean(),
              Type.Null(),
            ]),
            { maxItems: 100 },
          ),
          { maxItems: 200 },
        ),
      }),
    }),
    (a) => {
      const url = endpoint(
        'https://sheets.googleapis.com',
        `/v4/spreadsheets/${text(a, 'spreadsheetId')}/values/${text(a, 'range')}`,
        a,
        [],
      );
      url.searchParams.set('valueInputOption', 'RAW');
      return url;
    },
    true,
  ),
  operation(
    'service_google_slides_get',
    'google',
    'Slides',
    '读取演示文稿',
    true,
    'GET',
    object(googlePresentation),
    (a) =>
      endpoint(
        'https://slides.googleapis.com',
        `/v1/presentations/${text(a, 'presentationId')}`,
        a,
        [],
      ),
  ),
  operation(
    'service_google_slides_create',
    'google',
    'Slides',
    '创建演示文稿',
    false,
    'POST',
    object({ body: object({ title: Type.String({ minLength: 1, maxLength: 256 }) }) }),
    (a) => endpoint('https://slides.googleapis.com', '/v1/presentations', a, []),
    true,
  ),
  operation(
    'service_google_slides_update',
    'google',
    'Slides',
    '更新幻灯片对象',
    false,
    'POST',
    object({
      ...googlePresentation,
      body: object({ requests: Type.Array(body, { minItems: 1, maxItems: 100 }) }),
    }),
    (a) =>
      endpoint(
        'https://slides.googleapis.com',
        `/v1/presentations/${text(a, 'presentationId')}:batchUpdate`,
        a,
        [],
      ),
    true,
  ),
  operation(
    'service_google_calendar_events',
    'google',
    'Calendar',
    '列出日程',
    true,
    'GET',
    object({
      ...calendar,
      maxResults: pageSize,
      pageToken: Type.Optional(short),
      timeMin: Type.Optional(short),
      timeMax: Type.Optional(short),
    }),
    (a) =>
      endpoint(
        'https://www.googleapis.com',
        `/calendar/v3/calendars/${text(a, 'calendarId')}/events`,
        a,
        ['maxResults', 'pageToken', 'timeMin', 'timeMax'],
      ),
  ),
  operation(
    'service_google_calendar_create',
    'google',
    'Calendar',
    '创建日程',
    false,
    'POST',
    object({
      ...calendar,
      body: object({
        summary: Type.String({ minLength: 1, maxLength: 500 }),
        start: object({ dateTime: short, timeZone: Type.Optional(short) }),
        end: object({ dateTime: short, timeZone: Type.Optional(short) }),
        description: Type.Optional(Type.String({ maxLength: 10_000 })),
      }),
    }),
    (a) =>
      endpoint(
        'https://www.googleapis.com',
        `/calendar/v3/calendars/${text(a, 'calendarId')}/events`,
        a,
        [],
      ),
    true,
  ),
  operation(
    'service_vercel_projects',
    'vercel',
    'Projects',
    '列出Vercel项目',
    true,
    'GET',
    object({ limit: pageSize, teamId: Type.Optional(resourceId) }),
    (a) => endpoint('https://api.vercel.com', '/v9/projects', a, ['limit', 'teamId']),
  ),
  operation(
    'service_vercel_deployments',
    'vercel',
    'Deployments',
    '列出部署',
    true,
    'GET',
    object({
      limit: pageSize,
      projectId: Type.Optional(resourceId),
      teamId: Type.Optional(resourceId),
    }),
    (a) =>
      endpoint('https://api.vercel.com', '/v6/deployments', a, ['limit', 'projectId', 'teamId']),
  ),
  operation(
    'service_notion_search',
    'notion',
    'Search',
    '搜索Notion内容',
    true,
    'POST',
    object({
      body: object({
        query: Type.Optional(short),
        page_size: pageSize,
        start_cursor: Type.Optional(short),
      }),
    }),
    (a) => endpoint('https://api.notion.com', '/v1/search', a, []),
    true,
  ),
  operation(
    'service_notion_page',
    'notion',
    'Pages',
    '读取Notion页面',
    true,
    'GET',
    object({ pageId: resourceId }),
    (a) => endpoint('https://api.notion.com', `/v1/pages/${text(a, 'pageId')}`, a, []),
  ),
  operation(
    'service_notion_blocks',
    'notion',
    'Blocks',
    '读取页面内容块',
    true,
    'GET',
    object({ blockId: resourceId, page_size: pageSize, start_cursor: Type.Optional(short) }),
    (a) =>
      endpoint('https://api.notion.com', `/v1/blocks/${text(a, 'blockId')}/children`, a, [
        'page_size',
        'start_cursor',
      ]),
  ),
  operation(
    'service_notion_page_create',
    'notion',
    'Pages',
    '创建Notion页面',
    false,
    'POST',
    object({
      body: object({
        parent: body,
        properties: body,
        children: Type.Optional(Type.Array(body, { maxItems: 100 })),
      }),
    }),
    (a) => endpoint('https://api.notion.com', '/v1/pages', a, []),
    true,
  ),
  operation(
    'service_notion_blocks_append',
    'notion',
    'Blocks',
    '追加Notion内容块',
    false,
    'PATCH',
    object({
      blockId: resourceId,
      body: object({ children: Type.Array(body, { minItems: 1, maxItems: 100 }) }),
    }),
    (a) => endpoint('https://api.notion.com', `/v1/blocks/${text(a, 'blockId')}/children`, a, []),
    true,
  ),
  operation(
    'service_supabase_organizations',
    'supabase',
    'Organizations',
    '列出Supabase组织',
    true,
    'GET',
    none,
    (a) => endpoint('https://api.supabase.com', '/v1/organizations', a, []),
  ),
  operation(
    'service_supabase_projects',
    'supabase',
    'Projects',
    '列出Supabase项目',
    true,
    'GET',
    none,
    (a) => endpoint('https://api.supabase.com', '/v1/projects', a, []),
  ),
  operation(
    'service_supabase_advisors',
    'supabase',
    'Advisors',
    '读取项目安全建议',
    true,
    'GET',
    object({ projectRef: resourceId }),
    (a) =>
      endpoint(
        'https://api.supabase.com',
        `/v1/projects/${text(a, 'projectRef')}/advisors/security`,
        a,
        [],
      ),
  ),
];

export function connectionOperation(id: string): ConnectionOperation {
  const operation = CONNECTION_OPERATIONS.find((entry) => entry.id === id);
  if (operation === undefined) throw new Error('Unknown gateway operation');
  return operation;
}
