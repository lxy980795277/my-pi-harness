import { useCallback, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ConnectionView } from '@my-pi-harness/protocol';
import { useAsyncEvent } from '@/hooks/use-async-event';
import {
  beginConnectionAuthorization,
  reopenConnectionAuthorization,
  showConnectionAuthorization,
} from '@/features/connections/services/oauth-launch';
import type { ConnectionAuthorizationWindow } from '@/features/connections/services/oauth-window';
import {
  connectionAction,
  removeConnection,
  saveConnectionSecret,
} from '@/features/connections/services/connections';
import type {
  ConnectionAction,
  ConnectionItemState,
} from '@/features/connections/types/connection';

/** Raw credentials clear before awaiting the network and never enter the Query cache. */
export const useConnectionItem = (
  connection: ConnectionView,
  onEdit: (value: ConnectionView) => void,
): ConnectionItemState => {
  const client = useQueryClient();
  const [secret, setSecret] = useState('');
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);
  const [oauthPopup, setOauthPopup] = useState<ConnectionAuthorizationWindow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const refresh = useCallback(async (): Promise<void> => {
    await client.invalidateQueries({ queryKey: ['connections'] });
    await client.invalidateQueries({ queryKey: ['mcp'] });
  }, [client]);
  const changeSecret = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setSecret(event.target.value);
  }, []);
  const save = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        const value = secret;
        setSecret('');
        await saveConnectionSecret(connection, value, signal);
        await refresh();
      },
      [connection, refresh, secret],
    ),
  );
  const action = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, kind: ConnectionAction): Promise<void> => {
        if (kind === 'oauth/start') {
          const result = await beginConnectionAuthorization(connection, signal);
          if (signal.aborted) result.popup?.close();
          signal.throwIfAborted();
          setOauthUrl(result.url);
          setOauthPopup(result.popup);
          await showConnectionAuthorization(result);
        } else {
          await connectionAction(connection, kind, signal);
          signal.throwIfAborted();
          oauthPopup?.close();
          setOauthUrl(null);
          setOauthPopup(null);
        }
        await refresh();
      },
      [connection, oauthPopup, refresh],
    ),
  );
  const remove = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        await removeConnection(connection, signal);
        await refresh();
      },
      [connection, refresh],
    ),
  );
  const { run, clearError: clearActionError } = action;
  const connect = useCallback((): void => {
    run('oauth/start');
  }, [run]);
  const disconnect = useCallback((): void => {
    run('disconnect');
  }, [run]);
  const cancel = useCallback((): void => {
    run('oauth/cancel');
  }, [run]);
  const edit = useCallback((): void => {
    onEdit(connection);
  }, [connection, onEdit]);
  const askDelete = useCallback((): void => {
    setDeleting(true);
    setSecret('');
  }, []);
  const closeDelete = useCallback((open: boolean): void => {
    setDeleting(open);
  }, []);
  const reopen = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      if (oauthUrl !== null) {
        clearActionError();
        setOauthPopup(await reopenConnectionAuthorization(connection, oauthUrl));
      }
    }, [clearActionError, connection, oauthUrl]),
  );
  let secretLabel = '访问 Token';
  let saveLabel = '保存并连接';
  if (connection.authMode === 'oauth') {
    secretLabel = 'OAuth Client Secret';
    saveLabel = '保存 Client Secret';
  }
  let error = action.error;
  if (error === null) {
    error = save.error;
  }
  if (error === null) {
    error = remove.error;
  }
  if (error === null) {
    error = reopen.error;
  }
  return {
    secret,
    secretLabel,
    saveLabel,
    changeSecret,
    save: save.run,
    connect,
    disconnect,
    cancel,
    edit,
    askDelete,
    deleting,
    closeDelete,
    remove: remove.run,
    oauthUrl,
    reopen: reopen.run,
    pending: action.pending || save.pending || remove.pending || reopen.pending,
    error,
  };
};
