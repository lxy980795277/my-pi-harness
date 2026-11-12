import type {
  MemoryCreateInput,
  MemoryEntry,
  MemoryMutationResult,
  MessageView,
} from '@my-pi-harness/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type FC } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMemoryEditor } from '../src/features/memory/hooks/use-memory-editor';
import { createMemory, updateMemory } from '../src/features/memory/services/memory';
import type { MemoryEditorProps, MemoryEditorState } from '../src/features/memory/types/memory';
import { SaveMessageMemoryButton } from '../src/features/memory/components/save-message-memory';

const MESSAGE: MessageView = {
  id: 'message',
  sessionId: 'session',
  branchId: 'original-branch',
  runId: 'run',
  role: 'assistant',
  text: ' 保持中文回答 😀\n引用 **原文**。 ',
  thinking: '',
  createdAt: 1,
  status: 'complete',
  stopReason: 'stop',
};
const ENTRY: MemoryEntry = {
  id: 'memory',
  scope: { kind: 'user' },
  category: 'fact',
  body: '已保存的记忆',
  revision: 3,
  enabled: true,
  mode: 'fixed',
  source: { kind: 'manual' },
  createdAt: 1,
  updatedAt: 2,
};
const clients: QueryClient[] = [];
const events: MemoryEditorState[] = [];

vi.mock('../src/features/memory/services/memory', () => ({
  createMemory: vi.fn(),
  updateMemory: vi.fn(),
}));

const resultFor = (input: MemoryCreateInput): MemoryMutationResult => {
  return {
    entry: {
      ...ENTRY,
      body: input.body,
      scope: input.scope,
      source: input.source ?? { kind: 'manual' },
      mode: input.mode ?? 'fixed',
    },
    receipt: {
      requestId: input.requestId,
      operation: 'create',
      memoryId: ENTRY.id,
      revision: 1,
      status: 'applied',
    },
  };
};

const editor = (props: MemoryEditorProps): MemoryEditorState => {
  let state: MemoryEditorState | undefined;
  const Probe: FC = () => {
    state = useMemoryEditor(props);
    return null;
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Probe)));
  if (state === undefined) throw new Error('Editor did not render');
  events.push(state);
  return state;
};

afterEach(() => {
  for (const state of events) state.save.cancel();
  events.length = 0;
  for (const client of clients) client.clear();
  clients.length = 0;
  vi.resetAllMocks();
});

describe('human-confirmed memory editor', () => {
  it('opens and dismisses manual saving without creating a memory or sending a model request', () => {
    const close = vi.fn();
    const state = editor({
      target: { entry: null, message: MESSAGE, workspaceId: null, workspaceName: null },
      onClose: close,
    });
    expect(state.body).toBe(MESSAGE.text);
    state.close();
    expect(close).toHaveBeenCalledOnce();
    expect(createMemory).not.toHaveBeenCalled();
    expect(updateMemory).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(
      createElement(SaveMessageMemoryButton, { message: MESSAGE, onSave: vi.fn() }),
    );
    expect(html).toContain('保存到长期记忆');
    expect(html).not.toContain('生成建议');
    expect(
      renderToStaticMarkup(
        createElement(SaveMessageMemoryButton, {
          message: { ...MESSAGE, status: 'streaming' },
          onSave: vi.fn(),
        }),
      ),
    ).toBe('');
  });
  it('defaults to the current workspace and binds the full unedited source text in its visible branch', async () => {
    const create = vi.mocked(createMemory);
    create.mockImplementation((input) => {
      return Promise.resolve(resultFor(input));
    });
    const close = vi.fn();
    const state = editor({
      target: {
        entry: null,
        message: MESSAGE,
        workspaceId: 'workspace',
        workspaceName: '工作区',
        branchId: 'visible-branch',
      },
      onClose: close,
    });
    state.save.run();
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    const input = create.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      scope: { kind: 'workspace', workspaceId: 'workspace' },
      body: MESSAGE.text.trim(),
      mode: 'fixed',
      source: {
        kind: 'message',
        sessionId: 'session',
        messageId: 'message',
        branchId: 'visible-branch',
      },
    });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(MESSAGE.text));
    const hash = Buffer.from(digest).toString('hex');
    expect(input?.source).toMatchObject({ contentHash: hash });
    expect(updateMemory).not.toHaveBeenCalled();
  });

  it('retries an uncertain create with the same request and never silently creates another memory', async () => {
    const create = vi.mocked(createMemory);
    create.mockRejectedValueOnce(new Error('Connection lost'));
    create.mockImplementationOnce((input) => {
      return Promise.resolve(resultFor(input));
    });
    const close = vi.fn();
    const state = editor({
      target: { entry: null, message: MESSAGE, workspaceId: null, workspaceName: null },
      onClose: close,
    });
    state.save.run();
    await vi.waitFor(() => {
      state.save.run();
      expect(create).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]?.[0]).toEqual(create.mock.calls[1]?.[0]);
  });

  it('keeps the original edited revision and does not report success for a forgotten retry', async () => {
    const update = vi.mocked(updateMemory);
    update.mockResolvedValue({
      entry: null,
      receipt: {
        requestId: 'retry',
        operation: 'update',
        memoryId: ENTRY.id,
        revision: 4,
        status: 'applied',
      },
    });
    const close = vi.fn();
    const state = editor({
      target: { entry: ENTRY, workspaceId: null, workspaceName: null },
      onClose: close,
    });
    expect(state.scopeLocked).toBe(true);
    state.save.run();
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0]?.[1]).toMatchObject({ expectedRevision: 3, body: ENTRY.body });
    expect(close).not.toHaveBeenCalled();
  });

  it('preserves relevant mode explicitly when editing an existing memory', async () => {
    const update = vi.mocked(updateMemory);
    const relevant: MemoryEntry = { ...ENTRY, mode: 'relevant' };
    update.mockResolvedValue({
      entry: relevant,
      receipt: {
        requestId: 'updated',
        operation: 'update',
        memoryId: ENTRY.id,
        revision: 4,
        status: 'applied',
      },
    });
    const close = vi.fn();
    const saved = vi.fn();
    const state = editor({
      target: { entry: relevant, workspaceId: null, workspaceName: null },
      onClose: close,
      onSaved: saved,
    });
    expect(state.mode).toBe('relevant');
    state.save.run();
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(update.mock.calls[0]?.[1]).toMatchObject({ expectedRevision: 3, mode: 'relevant' });
    expect(saved).toHaveBeenCalledOnce();
  });

  it('uses an explicit related-mode creation choice rather than relying on the server fixed default', async () => {
    const create = vi.mocked(createMemory);
    create.mockImplementation((input) => {
      return Promise.resolve(resultFor(input));
    });
    const close = vi.fn();
    const state = editor({
      target: {
        entry: null,
        message: MESSAGE,
        workspaceId: null,
        workspaceName: null,
        defaultMode: 'relevant',
      },
      onClose: close,
    });
    expect(state.mode).toBe('relevant');
    state.save.run();
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]?.[0]).toMatchObject({ mode: 'relevant' });
  });
});
