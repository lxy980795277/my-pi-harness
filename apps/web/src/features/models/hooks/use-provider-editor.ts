import type { ProviderEditorState } from '@/features/models/types/model-view';
import type {
  AuthFlow,
  CustomProtocol,
  NativeProviderInfo,
  ProviderConfig,
  ProviderInput,
} from '@my-pi-harness/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { useWorkspaceStore } from '@/app/stores/workspace';
import { fetchAuthFlow, fetchAuthFlows } from '@/features/auth/services/auth';
import {
  saveProvider,
  startProviderAuth,
  writeProviderKey,
  deleteProvider,
  deleteProviderKey,
  logoutProvider,
} from '@/features/models/services/providers';
import {
  getProviderAuthentication,
  type AuthenticationMethod,
} from '@/features/models/utils/provider-authentication';
import { providerToInput } from '@/features/models/utils/model-options';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Configuration drafts and all secret values remain local to the editor's lifetime. */
export const useProviderEditor = (
  provider: ProviderConfig | null,
  native: NativeProviderInfo | undefined,
): ProviderEditorState => {
  const client = useQueryClient();
  const closeProvider = useWorkspaceStore((state) => {
    return state.closeProvider;
  });
  const flowId = useWorkspaceStore((state) => {
    return state.providerAuthFlowId;
  });
  const setFlowId = useWorkspaceStore((state) => {
    return state.setProviderAuthFlow;
  });
  const setAuthStarting = useWorkspaceStore((state) => {
    return state.setProviderAuthStarting;
  });
  // The draft's revision advances only after this editor's acknowledged save.
  const draftBase = useRef<ProviderConfig | null>(provider);
  const authentication = getProviderAuthentication(provider, native);
  const [name, setName] = useState(provider?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? '');
  const [api, setApi] = useState<CustomProtocol>(provider?.api ?? 'openai-responses');
  const [requiresApiKey, setRequiresApiKey] = useState(provider?.requiresApiKey ?? true);
  const [key, setKey] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [method, setMethod] = useState<AuthenticationMethod>(authentication.initialMethod);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCredential, setConfirmCredential] = useState(false);
  const [partialSaved, setPartialSaved] = useState(false);
  const custom = provider === null || provider.kind === 'custom';
  const { supportsApiKey, supportsOAuth } = authentication;
  let activeMethod = method;
  if ((method === 'api_key' && !supportsApiKey) || (method === 'oauth' && !supportsOAuth)) {
    activeMethod = authentication.initialMethod;
  }
  const flows = useQuery({
    queryKey: ['auth-flows'],
    queryFn: ({ signal }): Promise<AuthFlow[]> => {
      return fetchAuthFlows(signal);
    },
    enabled: provider !== null,
  });
  const flow = useQuery({
    queryKey: ['auth-flow', flowId],
    queryFn: ({ signal }): Promise<AuthFlow> => {
      if (flowId === null) {
        throw new Error('尚未创建授权流程。');
      }
      return fetchAuthFlow(flowId, signal);
    },
    enabled: flowId !== null,
  });

  useEffect(() => {
    if (flowId === null && provider) {
      const pending = flows.data?.find((item) => {
        return item.providerId === provider.id && item.status === 'pending';
      });
      if (pending) {
        setFlowId(pending.id);
      }
    }
  }, [flowId, flows.data, provider, setFlowId]);

  const refresh = useCallback(async (): Promise<void> => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['providers'] }),
      client.invalidateQueries({ queryKey: ['provider-models'] }),
      client.invalidateQueries({ queryKey: ['auth-flows'] }),
    ]);
  }, [client]);
  const putPublicProvider = useCallback(
    (saved: ProviderConfig): void => {
      client.setQueryData<ProviderConfig[]>(['providers'], (current) => {
        if (!current) {
          return current;
        }
        const exists = current.some((item) => {
          return item.id === saved.id;
        });
        if (!exists) {
          return [...current, saved];
        }
        return current.map((item) => {
          if (item.id === saved.id) {
            return saved;
          }
          return item;
        });
      });
    },
    [client],
  );

  const save = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, submittedKey: string): Promise<void> => {
        let target = draftBase.current;
        if (custom) {
          let input: ProviderInput = {
            name: name.trim(),
            kind: 'custom',
            builtinId: null,
            api,
            baseUrl: baseUrl.trim(),
            models: [],
            enabled: true,
            requiresApiKey,
          };
          if (target) {
            input = {
              ...providerToInput(target),
              name: name.trim(),
              baseUrl: baseUrl.trim(),
              api,
              requiresApiKey,
            };
          }
          target = await saveProvider(input, signal);
          draftBase.current = target;
          setPartialSaved(true);
          putPublicProvider(target);
        }
        if (target === null) {
          throw new Error('Provider 尚未创建。');
        }
        if (requiresApiKey && submittedKey.length > 0) {
          await writeProviderKey(target.id, submittedKey, signal);
        }
        signal.throwIfAborted();
        await refresh();
        signal.throwIfAborted();
        closeProvider();
      },
      [api, baseUrl, closeProvider, custom, name, putPublicProvider, refresh, requiresApiKey],
    ),
  );
  const { run: saveRun } = save;

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      const submittedKey = key.trim();
      setKey('');
      saveRun(submittedKey);
    },
    [key, saveRun],
  );
  const startAuth = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        if (provider === null) {
          throw new Error('请先保存 Provider。');
        }
        setKey('');
        setAuthStarting(true);
        try {
          const started = await startProviderAuth(provider.id, signal);
          client.setQueryData(['auth-flow', started.id], started);
          setFlowId(started.id);
          await client.invalidateQueries({ queryKey: ['auth-flows'] });
        } finally {
          setAuthStarting(false);
        }
      },
      [client, provider, setAuthStarting, setFlowId],
    ),
  );
  const removeCredential = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        if (!provider) {
          return;
        }
        if (provider.credentialType === 'oauth') {
          await logoutProvider(provider.id, signal);
        } else {
          await deleteProviderKey(provider.id, signal);
        }
        setKey('');
        await refresh();
        signal.throwIfAborted();
        setConfirmCredential(false);
      },
      [provider, refresh],
    ),
  );
  const remove = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        if (!provider || provider.kind !== 'custom') {
          return;
        }
        await deleteProvider(provider.id, signal);
        await refresh();
        signal.throwIfAborted();
        setConfirmDelete(false);
        closeProvider();
      },
      [closeProvider, provider, refresh],
    ),
  );
  const complete = useCallback((): void => {
    closeProvider();
  }, [closeProvider]);
  const changeApi = useCallback((value: string): void => {
    if (
      value === 'openai-responses' ||
      value === 'openai-completions' ||
      value === 'anthropic-messages'
    ) {
      setApi(value);
    }
  }, []);
  const changeMethod = useCallback(
    (value: string): void => {
      if ((value === 'api_key' && supportsApiKey) || (value === 'oauth' && supportsOAuth)) {
        setMethod(value);
        setKey('');
      }
    },
    [supportsApiKey, supportsOAuth],
  );
  const changeRequiresKey = useCallback((value: boolean): void => {
    setRequiresApiKey(value);
    setKey('');
  }, []);
  const toggleKey = useCallback((): void => {
    setKeyVisible((current) => {
      return !current;
    });
  }, []);
  const openCredentialRemoval = useCallback((): void => {
    setConfirmCredential(true);
  }, []);
  const openDelete = useCallback((): void => {
    setConfirmDelete(true);
  }, []);
  let inputType: 'text' | 'password' = 'password';
  if (keyVisible) {
    inputType = 'text';
  }
  let apiHelp = '通常填写包含 /v1 的服务基址。';
  if (api === 'anthropic-messages') {
    apiHelp = '填写服务根地址，例如 https://api.anthropic.com；Pi 会追加 /v1/messages。';
  }
  let title = '添加 Provider';
  if (provider) {
    title = `配置 ${provider.name}`;
  }
  let showSave = custom;
  if (
    provider &&
    provider.requiresApiKey &&
    supportsApiKey &&
    activeMethod === 'api_key' &&
    provider.credentialType === null
  ) {
    showSave = true;
  }
  const oauthActive =
    flowId !== null && flow.data?.status !== 'cancelled' && flow.data?.status !== 'failed';
  const busy = save.pending || startAuth.pending || removeCredential.pending || remove.pending;
  return {
    name,
    setName,
    baseUrl,
    setBaseUrl,
    api,
    changeApi,
    apiHelp,
    requiresApiKey,
    changeRequiresKey,
    key,
    setKey,
    inputType,
    toggleKey,
    keyVisible,
    method: activeMethod,
    supportsApiKey,
    changeMethod,
    custom,
    supportsOAuth,
    flowId,
    oauthActive,
    title,
    showSave,
    busy,
    submit,
    startAuth: startAuth.run,
    removeCredential: removeCredential.run,
    remove: remove.run,
    confirmDelete,
    confirmCredential,
    setConfirmCredential,
    openCredentialRemoval,
    setConfirmDelete,
    openDelete,
    complete,
    partialSaved,
    error: save.error ?? startAuth.error ?? removeCredential.error ?? remove.error,
    saveDisabled:
      busy ||
      oauthActive ||
      (!custom && key.trim().length === 0) ||
      (custom && (name.trim().length === 0 || baseUrl.trim().length === 0)),
    credentialPreview: provider?.credentialPreview ?? undefined,
    storedMethod: provider?.credentialType ?? null,
  };
};
