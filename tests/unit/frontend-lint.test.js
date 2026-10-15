import { fileURLToPath } from 'node:url';

import { createConfig } from '@my-pi-harness/eslint-config';
import { frontendPlugin } from '@my-pi-harness/eslint-config/frontend-rules';
import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

const rootDirectory = fileURLToPath(new URL('../../', import.meta.url));
const projectConfig = createConfig(rootDirectory);
const parser = projectConfig.find((config) => config.languageOptions?.parser)?.languageOptions
  .parser;
const typescriptPlugin = projectConfig.find((config) => config.plugins?.['@typescript-eslint'])
  ?.plugins['@typescript-eslint'];
const typescriptRules = Object.assign({}, ...projectConfig.map((config) => config.rules));
const webConfig = projectConfig.find(
  (config) => config.rules?.['project-react/component-declaration'],
);
const primitivesConfig = projectConfig.find((config) =>
  config.files?.includes('apps/web/src/components/ui/**/*.{ts,tsx}'),
);

if (
  !parser ||
  !typescriptPlugin ||
  !typescriptRules['@typescript-eslint/no-explicit-any'] ||
  !typescriptRules['@typescript-eslint/no-non-null-assertion'] ||
  !webConfig ||
  !primitivesConfig
) {
  throw new Error('Frontend fixtures require the actual project parser and Renderer rules.');
}

const languageOptions = {
  parser,
  parserOptions: { project: false, ecmaFeatures: { jsx: true }, sourceType: 'module' },
};
const pluginConfig = [
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions,
    plugins: { 'project-react': frontendPlugin },
    rules: {
      'project-react/component-declaration': 'error',
      'project-react/zustand-selector': 'error',
      'project-react/transport-owner': 'error',
      'project-react/presentation-only': 'error',
    },
  },
];
// Type-independent rules use the real parser without a synthetic tsconfig project.
const webFixtureConfig = [
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions,
    plugins: { '@typescript-eslint': typescriptPlugin },
    rules: {
      '@typescript-eslint/no-explicit-any': typescriptRules['@typescript-eslint/no-explicit-any'],
      '@typescript-eslint/no-non-null-assertion':
        typescriptRules['@typescript-eslint/no-non-null-assertion'],
    },
  },
  webConfig,
  primitivesConfig,
];
const defaultFilename = 'apps/web/src/features/fixture/index.tsx';

function lint(source, config = pluginConfig, filename = defaultFilename) {
  const linter = new Linter({ cwd: rootDirectory });
  const messages = linter.verify(source, config, {
    filename: fileURLToPath(new URL(filename, new URL('../../', import.meta.url))),
  });
  expect(messages.filter((message) => message.fatal || !message.ruleId)).toEqual([]);
  return messages;
}

function expectViolation(source, ruleId, messageId, filename = defaultFilename) {
  expect(lint(source, pluginConfig, filename)).toEqual([
    expect.objectContaining({ ruleId, messageId, severity: 2 }),
  ]);
}

describe('handwritten React component declarations', () => {
  it.each([
    ['untyped arrow', 'export const App = () => <main />;'],
    ['function declaration', 'export function App() { return <main />; }'],
    ['class component', 'export class App { render() { return <main />; } }'],
    ['mutable FC', 'export let App: FC = () => <main />;'],
    ['untyped memo', 'export const App = memo(() => <main />);'],
    ['untyped React.memo', 'export const App = React.memo(() => <main />);'],
    ['untyped forwardRef', 'export const App = forwardRef(() => <main />);'],
    ['untyped React.forwardRef', 'export const App = React.forwardRef(() => <main />);'],
  ])('rejects %s', (_name, source) => {
    expectViolation(source, 'project-react/component-declaration', 'component');
  });

  it.each([
    [
      'FC with props',
      'export const App: FC<Props> = ({ title }) => { return <main>{title}</main>; };',
    ],
    ['React.FC', 'export const App: React.FC = () => { return <main />; };'],
    ['typed memo', 'export const App: FC = memo(() => { return <main />; });'],
    ['typed React.memo', 'export const App: React.FC = React.memo(() => { return <main />; });'],
    ['typed forwardRef', 'export const App: FC<Props> = forwardRef(() => { return <main />; });'],
    [
      'data columns containing a JSX callback',
      'export const COLUMNS: ColumnDef[] = [{ cell: () => { return <span />; } }];',
    ],
    [
      'an uppercase data object with a JSX method',
      'export const CONFIG = { render() { return <span />; } };',
    ],
  ])('accepts %s', (_name, source) => {
    expect(lint(source)).toEqual([]);
  });
});

describe('Zustand subscriptions and action snapshots', () => {
  it.each([
    ['no selector', 'useSessionStore();'],
    ['entire state expression', 'useSessionStore((state) => state);'],
    ['entire state block', 'useSessionStore((state) => { return state; });'],
    ['entire state function', 'useSessionStore(function (state) { return state; });'],
  ])('rejects %s', (_name, source) => {
    expectViolation(source, 'project-react/zustand-selector', 'selector');
  });

  it.each([
    ['object literal', 'useSessionStore((state) => ({ id: state.id }));'],
    ['array literal', 'useSessionStore((state) => [state.id]);'],
    ['array fallback', 'useSessionStore((state) => state.items ?? []);'],
    ['object fallback', 'useSessionStore((state) => state.item || {});'],
    ['conditional fresh value', 'useSessionStore((state) => state.ready ? state.items : []);'],
    ['block return', 'useSessionStore((state) => { return { id: state.id }; });'],
    [
      'nested conditional return',
      'useSessionStore((state) => { if (state.ready) { return []; } return state.items; });',
    ],
    ['map result', 'useSessionStore((state) => state.items.map((item) => item.id));'],
    ['filter result', 'useSessionStore((state) => state.items.filter(Boolean));'],
    ['slice result', 'useSessionStore((state) => state.items.slice(0, 1));'],
    ['concat result', 'useSessionStore((state) => state.items.concat(state.other));'],
    ['flat result', 'useSessionStore((state) => state.items.flat());'],
    ['flatMap result', 'useSessionStore((state) => state.items.flatMap((item) => item.children));'],
    ['computed map result', "useSessionStore((state) => state.items['map']((item) => item.id));"],
  ])('rejects a fresh %s', (_name, source) => {
    expectViolation(source, 'project-react/zustand-selector', 'fresh');
  });

  it.each([
    ['state field', 'useSessionStore((state) => state.id);'],
    ['action field', 'useSessionStore((state) => state.selectSession);'],
    ['stable default', 'useSessionStore((state) => state.items ?? EMPTY_ITEMS);'],
    ['named selector', 'useSessionStore(selectSessionId);'],
    [
      'useShallow object',
      'useSessionStore(useShallow((state) => ({ id: state.id, select: state.selectSession })));',
    ],
    [
      'useShallow tuple',
      'useSessionStore(useShallow((state) => [state.id, state.selectSession]));',
    ],
    [
      'temporary local array',
      'useSessionStore((state) => { const local = []; audit(local); return state.items; });',
    ],
    ['map length scalar', 'useSessionStore((state) => state.items.map((item) => item.id).length);'],
    [
      'nested callback array',
      'useSessionStore((state) => { const prepare = () => { return []; }; audit(prepare); return state.items; });',
    ],
  ])('accepts %s', (_name, source) => {
    expect(lint(source)).toEqual([]);
  });

  it.each(['useSessionStore.getState();', "useSessionStore['getState']();"])(
    'rejects a component or Hook snapshot: %s',
    (source) => {
      expectViolation(source, 'project-react/zustand-selector', 'snapshot');
    },
  );

  it('allows a named snapshot inside the Store implementation', () => {
    expect(
      lint(
        'const state = useSessionStore.getState(); audit(state);',
        pluginConfig,
        'apps/web/src/features/session/stores/session.ts',
      ),
    ).toEqual([]);
  });

  it.each(['get().id;', "get()['id'];"])('rejects chained action reads: %s', (source) => {
    expectViolation(source, 'project-react/zustand-selector', 'chain');
  });

  it('allows the action to name its get() snapshot before reading fields', () => {
    expect(lint('const state = get(); audit(state.id);')).toEqual([]);
  });
});

describe('HTTP and SSE transport ownership', () => {
  it.each([
    'fetch("/api/health");',
    'window.fetch("/api/health");',
    'globalThis.fetch("/api/health");',
    'window["fetch"]("/api/health");',
    'globalThis["fetch"]("/api/health");',
  ])('rejects HTTP outside the common client: %s', (source) => {
    expectViolation(source, 'project-react/transport-owner', 'http');
  });

  it.each([
    'new EventSource("/api/runtime/events");',
    'new window.EventSource("/api/runtime/events");',
    'new globalThis.EventSource("/api/runtime/events");',
    'new window["EventSource"]("/api/runtime/events");',
    'new globalThis["EventSource"]("/api/runtime/events");',
  ])('rejects SSE outside the common client: %s', (source) => {
    expectViolation(source, 'project-react/transport-owner', 'sse');
  });

  it.each([
    ['HTTP', 'fetch("/api/health");', 'apps/web/src/services/base-request.ts'],
    ['SSE', 'new EventSource("/api/runtime/events");', 'apps/web/src/services/base-sse.ts'],
  ])('allows %s in its transport owner', (_name, source, filename) => {
    expect(lint(source, pluginConfig, filename)).toEqual([]);
  });

  it.each([
    [
      'HTTP',
      'fetch("/api/health");',
      'http',
      'apps/web/src/features/session/services/base-request.ts',
    ],
    [
      'SSE',
      'new EventSource("/api/runtime/events");',
      'sse',
      'apps/web/src/features/session/services/base-sse.ts',
    ],
    [
      'HTTP in the SSE client',
      'fetch("/api/health");',
      'http',
      'apps/web/src/services/base-sse.ts',
    ],
    [
      'SSE in the HTTP client',
      'new EventSource("/api/runtime/events");',
      'sse',
      'apps/web/src/services/base-request.ts',
    ],
  ])('rejects %s in a similarly named or unrelated file', (_name, source, messageId, filename) => {
    expectViolation(source, 'project-react/transport-owner', messageId, filename);
  });

  it('allows feature services to use the common clients', () => {
    expect(lint('requestJson("/api/health"); openRuntimeEvents(onReady);')).toEqual([]);
  });
});

describe('configured Renderer syntax rules', () => {
  it.each([
    ['concise arrow', 'const read = (): number => 1;', 'arrow-body-style'],
    ['default export', 'export default 1;', 'no-restricted-syntax'],
    [
      'JSX conditional',
      'export const App: FC = () => { return <main>{ready ? <span /> : null}</main>; };',
      'no-restricted-syntax',
    ],
    [
      'inline style',
      'export const App: FC = () => { return <main style={{ color: "red" }} />; };',
      'no-restricted-syntax',
    ],
    ['plain conditional', 'const value = ready ? 1 : 2;', 'no-restricted-syntax'],
    ['nested conditional', 'const value = ready ? active ? 1 : 2 : 3;', 'no-restricted-syntax'],
    ['void operator', 'void save();', 'no-restricted-syntax'],
    ['then chain', 'save().then(receive);', 'no-restricted-syntax'],
    ['catch chain', 'save().catch(report);', 'no-restricted-syntax'],
    ['finally chain', 'save().finally(clear);', 'no-restricted-syntax'],
    ['computed chain', 'save()["catch"](report);', 'no-restricted-syntax'],
    ['explicit any', 'type State = { value: any };', '@typescript-eslint/no-explicit-any'],
    ['double unknown cast', 'const state = value as unknown as State;', 'no-restricted-syntax'],
    ['non-null assertion', 'const state = value!;', '@typescript-eslint/no-non-null-assertion'],
    [
      'untyped function return',
      'const read = () => { return 1; };',
      '@typescript-eslint/explicit-function-return-type',
    ],
    [
      'conditional Hook',
      'export const App: FC = () => { if (ready) { useState(false); } return <main />; };',
      'react-hooks/rules-of-hooks',
    ],
    [
      'omitted Effect dependency',
      'export const App: FC<Props> = ({ title }) => { useEffect(() => { audit(title); }, []); return <main />; };',
      'react-hooks/exhaustive-deps',
    ],
    [
      'business Radix import',
      'import { Slot } from "@radix-ui/react-slot";',
      'no-restricted-imports',
    ],
    ['Node import', 'import { readFile } from "node:fs";', 'no-restricted-imports'],
    ['daemon import', 'import { start } from "@my-pi-harness/daemon";', 'no-restricted-imports'],
  ])('rejects %s using the actual Web rules', (_name, source, ruleId) => {
    expect(lint(source, webFixtureConfig)).toContainEqual(
      expect.objectContaining({ ruleId, severity: 2 }),
    );
  });

  it.each([
    ['typed FC', 'export const App: FC<Props> = ({ title }) => { return <main>{title}</main>; };'],
    [
      'typed memo component',
      'export const App: FC<Props> = memo(({ title }) => { return <main>{title}</main>; });',
    ],
    [
      'React.FC memo component',
      'export const App: React.FC = React.memo(() => { return <main />; });',
    ],
    [
      'typed library callback',
      'const callbacks: LibraryCallbacks = { onEvent: (event) => { return event.id; } };',
    ],
    [
      'typed direct callback',
      'const onEvent: LibraryCallbacks["onEvent"] = (event) => { return event.id; };',
    ],
    ['library callback argument', 'subscribe((event) => { audit(event); });'],
    ['explicit helper return', 'const read = (state: State): string => { return state.id; };'],
    [
      'JSX conjunction',
      'export const App: FC = () => { return <main>{ready && <span />}</main>; };',
    ],
    [
      'useShallow in a component',
      'export const App: FC = () => { const selected = useSessionStore(useShallow((state) => { return { id: state.id, select: state.selectSession }; })); return <main>{selected.id}</main>; };',
    ],
    [
      'subscribed action',
      'export const App: FC = () => { const select = useSessionStore((state: State): State["selectSession"] => { return state.selectSession; }); return <Button onClick={select} />; };',
    ],
  ])('accepts %s with the configured callback exceptions', (_name, source) => {
    expect(lint(source, webFixtureConfig)).toEqual([]);
  });

  it('allows Radix in handwritten UI primitives while retaining Renderer host restrictions', () => {
    const filename = 'apps/web/src/components/ui/button/index.tsx';
    expect(
      lint('import { Slot } from "@radix-ui/react-slot";', webFixtureConfig, filename),
    ).toEqual([]);
    expect(lint('import { readFile } from "node:fs";', webFixtureConfig, filename)).toContainEqual(
      expect.objectContaining({ ruleId: 'no-restricted-imports', severity: 2 }),
    );
  });

  it('still requires FC declarations in handwritten UI primitives', () => {
    expect(
      lint(
        'export const Button = () => { return <button />; };',
        webFixtureConfig,
        'apps/web/src/components/ui/button/index.tsx',
      ),
    ).toContainEqual(
      expect.objectContaining({ ruleId: 'project-react/component-declaration', severity: 2 }),
    );
  });
});

describe('TSX presentation ownership', () => {
  it.each([
    [
      'service call import',
      'import { fetchProviders } from "@/features/models/services/providers";',
      'service',
    ],
    [
      'relative service import',
      'import { fetchProviders } from "../../services/providers";',
      'service',
    ],
    ['common client import', 'import { requestJson } from "@/services/base-request";', 'service'],
    ['side-effect service import', 'import "@/services/base-request";', 'service'],
    ['query hook alias', 'import { useQuery as query } from "@tanstack/react-query";', 'service'],
    [
      'query client construction',
      'import { QueryClient } from "@tanstack/react-query";',
      'service',
    ],
    ['query namespace', 'import * as Query from "@tanstack/react-query";', 'service'],
    ['native button', 'const content = <button type="button">保存</button>;', 'control'],
    ['native input', 'const content = <input />;', 'control'],
    ['native option', 'const content = <option value="one">一</option>;', 'control'],
    ['native label', 'const content = <label htmlFor="one">一</label>;', 'control'],
    ['inline event arrow', 'const content = <Button onClick={() => { save(); }} />;', 'handler'],
    [
      'inline event function',
      'const content = <Button onClick={function () { save(); }} />;',
      'handler',
    ],
    [
      'map transformation',
      'const content = <div>{items.map((item) => { const label = describe(item); return <span>{label}</span>; })}</div>;',
      'transform',
    ],
  ])('rejects %s', (_name, source, messageId) => {
    expectViolation(source, 'project-react/presentation-only', messageId);
  });

  it.each([
    ['provider composition', 'import { QueryClientProvider } from "@tanstack/react-query";'],
    ['query type', 'import type { QueryClient } from "@tanstack/react-query";'],
    [
      'inline query type',
      'import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";',
    ],
    ['service type', 'import type { Input } from "@/features/models/services/providers";'],
    ['type specifier', 'import { type Input } from "@/features/models/services/providers";'],
    [
      'semantic markup',
      'const content = <main><form onSubmit={submit}><a href="https://example.com">文档</a><details><summary>详情</summary><span>内容</span></details></form></main>;',
    ],
    ['named handler', 'const content = <Button onClick={save}>保存</Button>;'],
    [
      'pure render map',
      'const content = <div>{items.map((item) => { return <span key={item.id}>{item.name}</span>; })}</div>;',
    ],
  ])('allows %s', (_name, source) => {
    expect(lint(source)).toEqual([]);
  });

  it('allows native controls only inside owned UI primitives', () => {
    expect(
      lint(
        'const content = <button type="button">保存</button>;',
        pluginConfig,
        'apps/web/src/components/ui/button/index.tsx',
      ),
    ).toEqual([]);
  });

  it('allows request orchestration in a typed Hook module', () => {
    expect(
      lint(
        'import { useQuery } from "@tanstack/react-query"; import { fetchProviders } from "@/features/models/services/providers";',
        pluginConfig,
        'apps/web/src/features/models/hooks/use-providers.ts',
      ),
    ).toEqual([]);
  });

  it('preserves void return types and async/await error handling', () => {
    expect(
      lint(
        'const save = async (): Promise<void> => { try { await persist(); } catch (failure: unknown) { report(failure); } finally { clear(); } };',
        webFixtureConfig,
      ),
    ).toEqual([]);
  });
});
