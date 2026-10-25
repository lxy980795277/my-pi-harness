import type { McpSecretState } from '@/features/mcp/types/mcp';
import { useCallback, useState, type ChangeEvent, type SubmitEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { McpServerView } from '@my-pi-harness/protocol';
import { deleteMcpSecret, writeMcpSecret } from '@/features/mcp/services/mcp';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Credential text lives only in this mounted form and is cleared before the request starts. */
export const useMcpSecret = (server: McpServerView): McpSecretState => {
  const client = useQueryClient();
  const [slotId, setSlotId] = useState(server.secretSlots[0]?.slotId ?? '');
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState(false);
  const write = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        const submitted = value;
        setValue('');
        setSaved(false);
        await writeMcpSecret(server, slotId, submitted, signal);
        await client.invalidateQueries({ queryKey: ['mcp'] });
        signal.throwIfAborted();
        setSaved(true);
      },
      [client, server, slotId, value],
    ),
  );
  const remove = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        setValue('');
        setSaved(false);
        await deleteMcpSecret(server, slotId, signal);
        await client.invalidateQueries({ queryKey: ['mcp'] });
      },
      [client, server, slotId],
    ),
  );
  const changeValue = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setValue(event.target.value);
    setSaved(false);
  }, []);
  const changeSlot = useCallback((next: string): void => {
    setSlotId(next);
    setValue('');
    setSaved(false);
  }, []);
  const { run } = write;
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>): void => {
      event.preventDefault();
      run();
    },
    [run],
  );
  const options = server.secretSlots.map((slot) => {
    let label = `${slot.environmentName} · 未配置`;
    if (slot.configured) {
      label = `${slot.environmentName} · 已配置`;
    }
    return { value: slot.slotId, label };
  });
  const selected = server.secretSlots.find((slot) => {
    return slot.slotId === slotId;
  });
  let error = write.error;
  if (error === null) {
    error = remove.error;
  }
  return {
    slotId,
    value,
    options,
    changeValue,
    changeSlot,
    submit,
    remove: remove.run,
    canRemove: selected?.configured === true,
    pending: write.pending || remove.pending,
    saved,
    error,
  };
};
