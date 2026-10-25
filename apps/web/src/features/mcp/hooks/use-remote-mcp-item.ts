import type { RemoteMcpItemState, RemoteMcpAction } from '@/features/mcp/types/mcp';
import { useCallback, useState, type ChangeEvent } from 'react';
import { Type } from 'typebox';
import { useQueryClient } from '@tanstack/react-query';
import type { RemoteMcpView, RemoteMcpTrustPreview } from '@my-pi-harness/protocol';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { openExternal } from '@/services/open-external';
import { parseResponse } from '@/utils/parse-response';
import {
  previewRemoteMcpTrust,
  trustRemoteMcp,
  remoteMcpAction,
  writeRemoteMcpSecret,
  deleteRemoteMcpSecret,
  removeRemoteMcp,
  testSavedRemoteMcp,
} from '@/features/mcp/services/remote-mcp';

interface ConnectionSummary {
  revision: number;
  message: string;
}

/** Secret values stay inside this mounted hook and clear after submission or closing. */
export const useRemoteMcpItem = (
  server: RemoteMcpView,
  onEdit: (value: RemoteMcpView) => void,
): RemoteMcpItemState => {
  const client = useQueryClient();
  const [preview, setPreview] = useState<RemoteMcpTrustPreview | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [secretsOpen, setSecretsOpen] = useState(false);
  const [secret, setSecret] = useState('');
  const [slot, setSlot] = useState(server.secretHeaders[0]?.slotId ?? '__oauth_client_secret__');
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);
  const [testSummary, setTestSummary] = useState<ConnectionSummary | null>(null);
  const refresh = useCallback(async (): Promise<void> => {
    await client.invalidateQueries({ queryKey: ['mcp'] });
  }, [client]);
  const startup = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        const value = await previewRemoteMcpTrust(server, signal);
        signal.throwIfAborted();
        setPreview(value);
      },
      [server],
    ),
  );
  const test = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        setTestSummary(null);
        const started = performance.now();
        const catalog = await testSavedRemoteMcp(server, signal);
        signal.throwIfAborted();
        setTestSummary({
          revision: server.revision,
          message: `连接成功 · ${catalog.tools.length} 个工具 · ${((performance.now() - started) / 1000).toFixed(1)} 秒`,
        });
        await refresh();
      },
      [refresh, server],
    ),
  );
  const trust = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        if (preview === null) {
          return;
        }
        await trustRemoteMcp(server, preview.fingerprint, signal);
        await refresh();
        signal.throwIfAborted();
        setPreview(null);
      },
      [preview, refresh, server],
    ),
  );
  const action = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, action: RemoteMcpAction): Promise<void> => {
        const value = await remoteMcpAction(server, action, signal);
        if (action === 'oauth/start') {
          const result = parseResponse(
            Type.Object({ url: Type.String(), state: Type.String(), expiresAt: Type.Integer() }),
            value,
          );
          signal.throwIfAborted();
          setOauthUrl(result.url);
          await openExternal(result.url);
        }
        await refresh();
      },
      [refresh, server],
    ),
  );
  const saveSecret = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        const value = secret;
        setSecret('');
        await writeRemoteMcpSecret(server, slot, value, signal);
        await refresh();
        signal.throwIfAborted();
        setSecretsOpen(false);
      },
      [refresh, secret, server, slot],
    ),
  );
  const removeSecret = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        setSecret('');
        await deleteRemoteMcpSecret(server, slot, signal);
        await refresh();
        signal.throwIfAborted();
        setSecretsOpen(false);
      },
      [refresh, server, slot],
    ),
  );
  const remove = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        await removeRemoteMcp(server, signal);
        await refresh();
      },
      [refresh, server],
    ),
  );
  const { run } = action;
  const discover = useCallback((): void => {
    run('discover');
  }, [run]);
  const disable = useCallback((): void => {
    run('disable');
  }, [run]);
  const connect = useCallback((): void => {
    run('oauth/start');
  }, [run]);
  const disconnect = useCallback((): void => {
    run('oauth/disconnect');
  }, [run]);
  const edit = useCallback((): void => {
    onEdit(server);
  }, [onEdit, server]);
  const openDelete = useCallback((): void => {
    setDeleting(true);
  }, []);
  const openSecrets = useCallback((): void => {
    setSecretsOpen(true);
  }, []);
  const changeSecrets = useCallback((open: boolean): void => {
    setSecretsOpen(open);
    if (!open) {
      setSecret('');
    }
  }, []);
  const changeSecret = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setSecret(event.target.value);
  }, []);
  const changeSlot = useCallback((value: string): void => {
    setSlot(value);
    setSecret('');
  }, []);
  const closeTrust = useCallback((open: boolean): void => {
    if (!open) {
      setPreview(null);
    }
  }, []);
  const reopenOAuth = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      if (oauthUrl !== null) {
        await openExternal(oauthUrl);
      }
    }, [oauthUrl]),
  );
  const refreshAction = useAsyncEvent(refresh);
  let error = action.error;
  if (error === null) {
    error = startup.error;
  }
  if (error === null) {
    error = saveSecret.error;
  }
  if (error === null) {
    error = removeSecret.error;
  }
  if (error === null) {
    error = test.error;
  }
  const slotOptions = server.secretHeaders.map((entry) => {
    return { label: entry.headerName, value: entry.slotId };
  });
  if (server.oauthClient?.clientSecret === true) {
    slotOptions.push({ label: 'OAuth Client Secret', value: '__oauth_client_secret__' });
  }
  let visibleTestSummary: string | null = null;
  if (testSummary !== null && testSummary.revision === server.revision) {
    visibleTestSummary = testSummary.message;
  }
  return {
    preview,
    deleting,
    changeDeleting: setDeleting,
    secretsOpen,
    changeSecrets,
    secret,
    slot,
    slotOptions,
    changeSecret,
    changeSlot,
    openSecrets,
    saveSecret: saveSecret.run,
    saveSecretError: saveSecret.error,
    removeSecret: removeSecret.run,
    canRemoveSecret:
      (slot === '__oauth_client_secret__' && server.oauthClientSecretConfigured === true) ||
      server.secretHeaders.some((entry) => {
        return entry.slotId === slot && entry.configured;
      }),
    openDelete,
    edit,
    discover,
    test: test.run,
    testSummary: visibleTestSummary,
    disable,
    connect,
    disconnect,
    startup: startup.run,
    trust: trust.run,
    closeTrust,
    trustError: trust.error,
    remove: remove.run,
    removeError: remove.error,
    refresh: refreshAction.run,
    reopenOAuth: reopenOAuth.run,
    oauthUrl,
    error,
    pending:
      startup.pending ||
      trust.pending ||
      action.pending ||
      test.pending ||
      saveSecret.pending ||
      removeSecret.pending ||
      remove.pending,
  };
};
