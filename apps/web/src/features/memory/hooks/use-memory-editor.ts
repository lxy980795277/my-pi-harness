import type { MemoryEntry, MemoryMutationResult, MemorySource } from '@my-pi-harness/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState, type ChangeEvent, type SubmitEvent } from 'react';
import type {
  MemoryEditorAttempt,
  MemoryEditorProps,
  MemoryEditorState,
} from '@/features/memory/types/memory';
import { createMemory, updateMemory } from '@/features/memory/services/memory';
import { refreshMemoryFacts } from '@/features/memory/queries/cache';
import {
  memoryScopeKey,
  memoryScopeOptions,
  memorySourceLabel,
  resolveMemoryScope,
} from '@/features/memory/utils/memory-view';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { memoryMessageSource } from '@/features/memory/utils/message-source';

/** Only a visible persisted message can become a source; edited memory text remains explicit. */
const editorSource = async (target: MemoryEditorProps['target']): Promise<MemorySource> => {
  if (target.message === undefined) return { kind: 'manual' };
  const message = target.message;
  return memoryMessageSource(message, target.branchId ?? message.branchId);
};

/** Drafts are local; retries preserve the exact write and the revision the user edited. */
export const useMemoryEditor = ({
  target,
  onClose,
  onSaved,
}: MemoryEditorProps): MemoryEditorState => {
  const client = useQueryClient();
  const entry = target.entry;
  let initialBody = '';
  let initialScope = 'user';
  if (target.message !== undefined) initialBody = target.message.text;
  if (target.workspaceId !== null) {
    initialScope = memoryScopeKey({ kind: 'workspace', workspaceId: target.workspaceId });
  }
  if (target.defaultScope !== undefined) initialScope = memoryScopeKey(target.defaultScope);
  if (entry !== null) {
    initialBody = entry.body;
    initialScope = memoryScopeKey(entry.scope);
  }
  const [body, setBody] = useState(initialBody);
  const [category, setCategory] = useState<MemoryEntry['category']>(entry?.category ?? 'fact');
  let initialMode: MemoryEntry['mode'] = 'fixed';
  if (target.defaultMode !== undefined) initialMode = target.defaultMode;
  if (entry !== null) initialMode = entry.mode;
  const [mode, setMode] = useState(initialMode);
  const [enabled, setEnabled] = useState(entry?.enabled ?? true);
  const [scope, setScope] = useState(initialScope);
  const attempt = useRef<MemoryEditorAttempt | null>(null);
  const save = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        const fields = { category, body: body.trim(), enabled, mode };
        if (fields.body.length === 0) throw new Error('请填写要保存的记忆。');
        const fingerprint = JSON.stringify({ id: entry?.id, ...fields, scope });
        let input = attempt.current?.input;
        if (attempt.current?.fingerprint !== fingerprint || input === undefined) {
          if (entry === null) {
            const source = await editorSource(target);
            signal.throwIfAborted();
            input = {
              requestId: crypto.randomUUID(),
              scope: resolveMemoryScope(scope, target.workspaceId),
              ...fields,
              source,
            };
          } else {
            input = { requestId: crypto.randomUUID(), expectedRevision: entry.revision, ...fields };
          }
          attempt.current = { fingerprint, input };
        }
        try {
          let result: MemoryMutationResult;
          if ('scope' in input) result = await createMemory(input, signal);
          else {
            if (entry === null) throw new Error('缺少要修改的记忆。');
            result = await updateMemory(entry.id, input, signal);
          }
          signal.throwIfAborted();
          if (result.entry === null) {
            throw new Error('这次保存对应的记忆已被忘记，请关闭并刷新列表。');
          }
          onSaved?.();
          onClose();
        } finally {
          await refreshMemoryFacts(client);
        }
      },
      [body, category, client, enabled, entry, mode, onClose, onSaved, scope, target],
    ),
  );
  const { run, pending, cancel } = save;
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>): void => {
      event.preventDefault();
      run();
    },
    [run],
  );
  const close = useCallback((): void => {
    if (pending) return;
    cancel();
    onClose();
  }, [cancel, onClose, pending]);
  const changeOpen = useCallback(
    (open: boolean): void => {
      if (!open) close();
    },
    [close],
  );
  const changeBody = useCallback((event: ChangeEvent<HTMLTextAreaElement>): void => {
    setBody(event.target.value);
  }, []);
  const changeCategory = useCallback((value: string): void => {
    if (value === 'preference' || value === 'fact' || value === 'instruction') setCategory(value);
  }, []);
  const changeMode = useCallback((value: string): void => {
    if (value === 'fixed' || value === 'relevant') setMode(value);
  }, []);
  const options = memoryScopeOptions(target.workspaceId, target.workspaceName);
  let title = '保存到长期记忆';
  let sourceLabel = '手工保存';
  if (entry !== null) {
    title = '编辑记忆';
    sourceLabel = memorySourceLabel(entry.source);
  } else if (target.message !== undefined) sourceLabel = '来自消息 · 请确认要长期保留的内容';
  return {
    title,
    body,
    category,
    mode,
    enabled,
    scope,
    scopeOptions: options,
    scopeLocked: entry !== null,
    sourceLabel,
    changeBody,
    changeCategory,
    changeMode,
    changeEnabled: setEnabled,
    changeScope: setScope,
    submit,
    save,
    close,
    changeOpen,
  };
};
