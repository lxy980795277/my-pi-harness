import { useCallback, useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ConnectionAuthMode,
  ConnectionServiceId,
  ConnectionView,
  ConnectionInput,
} from '@my-pi-harness/protocol';
import { useAsyncEvent } from '@/hooks/use-async-event';
import type {
  ConnectionsSettingsState,
  ConnectionEditorState,
} from '@/features/connections/types/connection';
import {
  createConnection,
  fetchConnectionProviders,
  fetchConnections,
  updateConnection,
} from '@/features/connections/services/connections';

/** Public configuration uses Query; secrets belong only to the mounted item editor. */
export const useConnectionsSettings = (): ConnectionsSettingsState => {
  const client = useQueryClient();
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
  const [editing, setEditing] = useState<ConnectionEditorState>(undefined);
  const [serviceId, setServiceId] = useState<ConnectionServiceId>('github');
  const [authMode, setAuthMode] = useState<ConnectionAuthMode>('oauth');
  const [name, setName] = useState('GitHub');
  const [clientId, setClientId] = useState('');
  const [scopes, setScopes] = useState('read:user\nrepo');
  const open = useCallback((): void => {
    setEditing(null);
    setServiceId('github');
    setAuthMode('oauth');
    setName('GitHub');
    setClientId('');
    setScopes('read:user\nrepo');
  }, []);
  const edit = useCallback((connection: ConnectionView): void => {
    setEditing(connection);
    setServiceId(connection.serviceId);
    setAuthMode(connection.authMode);
    setName(connection.name);
    setClientId(connection.clientId);
    setScopes(connection.scopes.join('\n'));
  }, []);
  const close = useCallback((open: boolean): void => {
    if (!open) {
      setEditing(undefined);
    }
  }, []);
  const changeService = useCallback(
    (value: string): void => {
      const provider = providers.data?.find((entry) => {
        return entry.serviceId === value;
      });
      if (provider === undefined || editing !== null) {
        return;
      }
      setServiceId(provider.serviceId);
      setName(provider.name);
      setScopes(provider.defaultScopes.join('\n'));
    },
    [editing, providers.data],
  );
  const changeAuth = useCallback((value: string): void => {
    if (value === 'oauth' || value === 'token') {
      setAuthMode(value);
    }
  }, []);
  const changeName = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setName(event.target.value);
  }, []);
  const changeClientId = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setClientId(event.target.value);
  }, []);
  const changeScopes = useCallback((event: ChangeEvent<HTMLTextAreaElement>): void => {
    setScopes(event.target.value);
  }, []);
  const save = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        if (editing === undefined) {
          return;
        }
        const input: ConnectionInput = {
          serviceId,
          authMode,
          name,
          clientId,
          scopes: scopes.split(/\s+/).filter(Boolean),
        };
        if (editing === null) {
          await createConnection(input, signal);
        } else {
          await updateConnection(
            editing.id,
            { ...input, expectedRevision: editing.revision },
            signal,
          );
        }
        await client.invalidateQueries({ queryKey: ['connections'] });
        signal.throwIfAborted();
        setEditing(undefined);
      },
      [authMode, client, clientId, editing, name, scopes, serviceId],
    ),
  );
  const refresh = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await client.invalidateQueries({ queryKey: ['connections'] });
    }, [client]),
  );
  const providerOptions = (providers.data ?? []).map((provider) => {
    return { value: provider.serviceId, label: provider.name };
  });
  return {
    connections,
    providers,
    providerOptions,
    editing,
    serviceId,
    authMode,
    name,
    clientId,
    scopes,
    open,
    edit,
    close,
    changeService,
    changeAuth,
    changeName,
    changeClientId,
    changeScopes,
    save: save.run,
    pending: save.pending,
    error: save.error,
    refresh: refresh.run,
  };
};
