import type { QueryClient } from '@tanstack/react-query';
import type { ToolCallView } from '@my-pi-harness/protocol';

const MEMORY_WRITES = new Set(['save_memory', 'learn_memory', 'update_memory', 'delete_memory']);

/** Only completed native memory writes can invalidate the current facts; reads and lookalikes cannot. */
export const completedMemoryWriteIds = (tools: readonly ToolCallView[]): string[] => {
  return tools
    .filter((tool) => {
      return (
        tool.status === 'completed' &&
        tool.binding.kind === 'accepted' &&
        tool.binding.source.kind === 'session' &&
        MEMORY_WRITES.has(tool.name)
      );
    })
    .map((tool) => {
      return tool.id;
    });
};

/** A completed write supersedes even an initial read which has not populated its cache yet. */
export const refreshMemoryFacts = async (client: QueryClient): Promise<void> => {
  await Promise.all([
    client.cancelQueries({ queryKey: ['memories'] }),
    client.cancelQueries({ queryKey: ['memory-current'] }),
    client.cancelQueries({
      predicate: (query) => {
        return query.meta?.memorySource === true;
      },
    }),
  ]);
  await Promise.all([
    client.invalidateQueries({ queryKey: ['memories'] }),
    client.invalidateQueries({ queryKey: ['memory-current'] }),
    client.invalidateQueries({ queryKey: ['search-index'] }),
    client.invalidateQueries({
      predicate: (query) => {
        return query.meta?.memorySource === true;
      },
    }),
  ]);
};
