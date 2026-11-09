import type { McpConfigurationExchangeState } from '@/features/mcp/types/mcp';
import { useCallback, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBlobDownload } from '@/hooks/use-blob-download';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { fetchMcpConfiguration, importMcpConfiguration } from '@/features/mcp/services/remote-mcp';

/** Preview is tied to the exact edited JSON; changing it requires another validation. */
export const useMcpConfigurationExchange = (): McpConfigurationExchangeState => {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [encoded, setEncoded] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const download = useBlobDownload(
    'mcp-configuration',
    useCallback(async (signal: AbortSignal): Promise<Blob> => {
      const config = await fetchMcpConfiguration(signal);
      return new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    }, []),
    'mcp-configuration.json',
  );
  const inspect = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        const result = await importMcpConfiguration(encoded, true, signal);
        signal.throwIfAborted();
        setPreview(encoded);
        setSummary([...result.local, ...result.remote, ...result.warnings].join('\n'));
      },
      [encoded],
    ),
  );
  const save = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        if (preview === null || preview !== encoded) {
          throw new Error('请先预览当前JSON。');
        }
        await importMcpConfiguration(encoded, false, signal);
        await client.invalidateQueries({ queryKey: ['mcp'] });
        signal.throwIfAborted();
        setOpen(false);
        setEncoded('');
        setPreview(null);
      },
      [client, encoded, preview],
    ),
  );
  const show = useCallback((): void => {
    setOpen(true);
  }, []);
  const change = useCallback((event: ChangeEvent<HTMLTextAreaElement>): void => {
    setEncoded(event.target.value);
    setPreview(null);
    setSummary(null);
  }, []);
  let error = inspect.error;
  if (error === null) {
    error = save.error;
  }
  if (error === null) {
    error = download.error;
  }
  return {
    open,
    changeOpen: setOpen,
    show,
    encoded,
    change,
    summary,
    preview,
    download: download.run,
    inspect: inspect.run,
    save: save.run,
    error,
    pending: download.pending || inspect.pending || save.pending,
  };
};
