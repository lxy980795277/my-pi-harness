import type { AttachmentContent } from '@my-pi-harness/protocol';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { fetchAttachmentContent } from '@/features/attachments/services/attachments';

/** Unmounting the last open preview cancels its request and releases original content. */
export const useAttachmentContent = (id: string): UseQueryResult<AttachmentContent, Error> => {
  return useQuery({
    queryKey: ['attachment-content', id],
    queryFn: ({ signal }) => {
      return fetchAttachmentContent(id, signal);
    },
    gcTime: 0,
  });
};
