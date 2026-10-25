import type { McpServerFormState } from '@/features/mcp/types/mcp';
import { useCallback, useState, type ChangeEvent, type SubmitEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { McpServerView } from '@my-pi-harness/protocol';
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces';
import { createMcpServer, updateMcpServer } from '@/features/mcp/services/mcp';
import { mcpServerForm, parseMcpServerForm } from '@/features/mcp/utils/mcp-form';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** A mounted form owns one observed revision; conflicts require reopening the current configuration. */
export const useMcpServerForm = (
  server: McpServerView | null,
  onClose: () => void,
): McpServerFormState => {
  const [form, setForm] = useState(() => {
    return mcpServerForm(server);
  });
  const workspaces = useWorkspaces();
  const client = useQueryClient();
  const save = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        const input = parseMcpServerForm(form);
        if (server === null) {
          await createMcpServer(input, signal);
        } else {
          await updateMcpServer(server.id, { ...input, expectedRevision: server.revision }, signal);
        }
        await client.invalidateQueries({ queryKey: ['mcp'] });
        signal.throwIfAborted();
        onClose();
      },
      [client, form, onClose, server],
    ),
  );
  const changeField = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      const { name, value } = event.target;
      if (
        name === 'name' ||
        name === 'command' ||
        name === 'args' ||
        name === 'publicEnvironment' ||
        name === 'secretSlots'
      ) {
        setForm((current) => {
          return { ...current, [name]: value };
        });
      }
    },
    [],
  );
  const changeWorkspace = useCallback((workspaceId: string): void => {
    setForm((current) => {
      return { ...current, workspaceId };
    });
  }, []);
  const { run } = save;
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>): void => {
      event.preventDefault();
      run();
    },
    [run],
  );
  const workspaceOptions = (workspaces.data ?? []).map((workspace) => {
    return { value: workspace.id, label: workspace.name };
  });
  return {
    form,
    workspaceOptions,
    changeField,
    changeWorkspace,
    submit,
    pending: save.pending,
    error: save.error,
  };
};
