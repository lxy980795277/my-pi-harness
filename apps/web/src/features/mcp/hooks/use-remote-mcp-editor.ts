import type { RemoteMcpView } from '@my-pi-harness/protocol';
import { useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { InputChange, FormSubmit, TextChange } from '@/types/events';
import type { RemoteMcpDraft, RemoteMcpEditorMode } from '@/features/mcp/types/remote-mcp';
import type {
  RemoteMcpEditorState,
  RemoteMcpHeaderRow,
  RemoteMcpHeaderField,
} from '@/features/mcp/types/remote-mcp-editor';
import {
  createRemoteMcpDraft,
  encodeRemoteMcpDraft,
  parseRemoteMcpDraft,
  prepareRemoteMcpDraft,
  clearRemoteMcpDraftSecrets,
} from '@/features/mcp/utils/remote-mcp-configuration';
import {
  createRemoteMcp,
  updateRemoteMcp,
  writeRemoteMcpSecret,
  testRemoteMcpDraft,
  testSavedRemoteMcp,
} from '@/features/mcp/services/remote-mcp';
import {
  fetchConnections,
  fetchConnectionProviders,
} from '@/features/connections/services/connections';
import { prepareRemoteMcpTest } from '@/features/mcp/utils/remote-mcp-test';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { describeError } from '@/utils/describe-error';

/** The mounted editor owns raw headers; only public configurations enter Query. */
export const useRemoteMcpEditor = (
  server: RemoteMcpView | null,
  onClose: () => void,
): RemoteMcpEditorState => {
  const client = useQueryClient();
  const observed = useRef(server);
  const [draft, setDraft] = useState(() => {
    return createRemoteMcpDraft(server);
  });
  const [encoded, setEncoded] = useState(() => {
    return encodeRemoteMcpDraft(createRemoteMcpDraft(server));
  });
  const [mode, setMode] = useState<RemoteMcpEditorMode>('form');
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [testSummary, setTestSummary] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const connections = useQuery({
    queryKey: ['connections'],
    queryFn: ({ signal }) => {
      return fetchConnections(signal);
    },
  });
  const providers = useQuery({
    queryKey: ['connections', 'providers'],
    queryFn: ({ signal }) => {
      return fetchConnectionProviders(signal);
    },
  });
  const readDraft = useCallback((): RemoteMcpDraft => {
    if (mode === 'json') return parseRemoteMcpDraft(encoded);
    return draft;
  }, [draft, encoded, mode]);
  const clearSecrets = useCallback((value: RemoteMcpDraft): void => {
    const cleared = clearRemoteMcpDraftSecrets(value);
    setDraft(cleared);
    setEncoded(encodeRemoteMcpDraft(cleared));
  }, []);
  const save = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        const value = readDraft();
        const prepared = prepareRemoteMcpDraft(value, observed.current);
        clearSecrets(value);
        setTestSummary(null);
        try {
          let saved: RemoteMcpView;
          if (observed.current === null) {
            saved = await createRemoteMcp(prepared.input, signal);
          } else {
            saved = await updateRemoteMcp(
              observed.current.id,
              { ...prepared.input, expectedRevision: observed.current.revision },
              signal,
            );
          }
          observed.current = saved;
          for (const secret of prepared.secrets) {
            saved = await writeRemoteMcpSecret(saved, secret.slotId, secret.value, signal);
            observed.current = saved;
          }
          signal.throwIfAborted();
          onClose();
        } catch (failure: unknown) {
          if (!signal.aborted && observed.current !== null) {
            const savedDraft = createRemoteMcpDraft(observed.current);
            setDraft(savedDraft);
            setEncoded(encodeRemoteMcpDraft(savedDraft));
            setNotice('请检查已保存的配置；未保存的请求头值需要重新填写。');
          }
          throw failure;
        } finally {
          await client.invalidateQueries({ queryKey: ['mcp'] });
        }
      },
      [clearSecrets, client, onClose, readDraft],
    ),
  );
  const test = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        setTestSummary(null);
        const value = readDraft();
        const plan = prepareRemoteMcpTest(value, observed.current);
        if (plan.kind === 'saved') {
          const started = performance.now();
          const catalog = await testSavedRemoteMcp(plan.server, signal);
          signal.throwIfAborted();
          setTestSummary(
            `连接成功 · ${catalog.tools.length} 个工具 · ${((performance.now() - started) / 1000).toFixed(1)} 秒`,
          );
          return;
        }
        clearSecrets(value);
        if (plan.clearsSecrets) {
          setNotice('本次测试提交的请求头值已清空，保存前请重新填写。');
        }
        const result = await testRemoteMcpDraft(plan.input, signal);
        signal.throwIfAborted();
        setTestSummary(
          `连接成功 · ${result.toolCount} 个工具 · ${(result.elapsedMs / 1000).toFixed(1)} 秒`,
        );
      },
      [clearSecrets, readDraft],
    ),
  );
  const { clearError: clearSaveError, run: saveRun } = save;
  const { clearError: clearTestError, pending: testPending } = test;
  const clearFeedback = useCallback((): void => {
    setConversionError(null);
    setTestSummary(null);
    setNotice(null);
    clearSaveError();
    clearTestError();
  }, [clearSaveError, clearTestError]);
  const changeMode = useCallback(
    (value: string): void => {
      if (value !== 'form' && value !== 'json') return;
      try {
        if (value === 'form') setDraft(parseRemoteMcpDraft(encoded));
        else setEncoded(encodeRemoteMcpDraft(draft));
        clearFeedback();
        setMode(value);
      } catch (failure: unknown) {
        setConversionError(describeError(failure));
      }
    },
    [clearFeedback, draft, encoded],
  );
  const changeField = useCallback<InputChange>(
    (event): void => {
      const { name, value } = event.target;
      if (name !== 'mcpId' && name !== 'endpoint') return;
      clearFeedback();
      setDraft((current) => {
        return { ...current, [name]: value };
      });
    },
    [clearFeedback],
  );
  const changeEncoded = useCallback<TextChange>(
    (event): void => {
      clearFeedback();
      setEncoded(event.target.value);
    },
    [clearFeedback],
  );
  const changeTransport = useCallback(
    (transport: string): void => {
      if (transport !== 'streamable-http' && transport !== 'sse') return;
      clearFeedback();
      setDraft((current) => {
        return { ...current, transport };
      });
    },
    [clearFeedback],
  );
  const changeHeader = useCallback(
    (id: string, field: RemoteMcpHeaderField, value: string): void => {
      clearFeedback();
      setDraft((current) => {
        return {
          ...current,
          headers: current.headers.map((header) => {
            if (header.id !== id) return header;
            return { ...header, [field]: value };
          }),
        };
      });
    },
    [clearFeedback],
  );
  const removeHeader = useCallback(
    (id: string): void => {
      clearFeedback();
      setDraft((current) => {
        return {
          ...current,
          headers: current.headers.filter((header) => {
            return header.id !== id;
          }),
        };
      });
    },
    [clearFeedback],
  );
  const addHeader = useCallback((): void => {
    clearFeedback();
    setDraft((current) => {
      return {
        ...current,
        headers: [
          ...current.headers,
          {
            id: crypto.randomUUID(),
            name: '',
            value: '',
            slotId: crypto.randomUUID(),
            configured: false,
            kind: 'secret',
          },
        ],
      };
    });
  }, [clearFeedback]);
  const changeOAuth = useCallback(
    (oauth: boolean): void => {
      clearFeedback();
      setDraft((current) => {
        const next = { ...current, oauth };
        if (oauth) delete next.connectionId;
        else delete next.oauthClient;
        return next;
      });
    },
    [clearFeedback],
  );
  const changeConnection = useCallback(
    (value: string): void => {
      clearFeedback();
      setDraft((current) => {
        const next = { ...current };
        if (value === 'independent') delete next.connectionId;
        else {
          next.connectionId = value;
          next.oauth = false;
          delete next.oauthClient;
          next.headers = next.headers.filter((header) => {
            return header.name.toLowerCase() !== 'authorization';
          });
        }
        return next;
      });
    },
    [clearFeedback],
  );
  const connectionOptions = [{ value: 'independent', label: '独立配置' }];
  for (const connection of connections.data ?? []) {
    const provider = providers.data?.find((entry) => {
      return entry.serviceId === connection.serviceId;
    });
    if (!connection.connected || provider === undefined) continue;
    if (provider.mcpEndpoints.includes(draft.endpoint.trim())) {
      connectionOptions.push({
        value: connection.id,
        label: `${provider.name} · ${connection.name}`,
      });
    }
  }
  let connectionId = 'independent';
  if (draft.connectionId !== undefined) {
    connectionId = draft.connectionId;
    if (
      !connectionOptions.some((option) => {
        return option.value === connectionId;
      })
    ) {
      connectionOptions.push({ value: connectionId, label: '当前连接（地址不匹配或已断开）' });
    }
  }
  const headerRows: RemoteMcpHeaderRow[] = draft.headers.map((header) => {
    let inputType: RemoteMcpHeaderRow['inputType'] = 'password';
    if (header.kind === 'public') inputType = 'text';
    let placeholder = 'Bearer <token>';
    if (header.configured) placeholder = '已保存，留空保留';
    return {
      ...header,
      inputType,
      placeholder,
      changeName: (event): void => {
        changeHeader(header.id, 'name', event.target.value);
      },
      changeValue: (event): void => {
        changeHeader(header.id, 'value', event.target.value);
      },
      remove: (): void => {
        removeHeader(header.id);
      },
    };
  });
  const submit = useCallback<FormSubmit>(
    (event): void => {
      event.preventDefault();
      if (!testPending) saveRun();
    },
    [saveRun, testPending],
  );
  const changeOpen = useCallback(
    (open: boolean): void => {
      if (!open) onClose();
    },
    [onClose],
  );
  let error = conversionError;
  if (error === null) error = save.error;
  if (error === null) error = test.error;
  let title = '添加 MCP 服务器';
  if (server !== null) title = '编辑 MCP 服务器';
  return {
    title,
    mode,
    draft,
    encoded,
    headerRows,
    changeMode,
    changeField,
    changeTransport,
    changeEncoded,
    addHeader,
    changeOAuth,
    connectionId,
    connectionOptions,
    changeConnection,
    changeOpen,
    submit,
    test: test.run,
    pending: save.pending || test.pending,
    saving: save.pending,
    testing: test.pending,
    error,
    testSummary,
    notice,
  };
};
