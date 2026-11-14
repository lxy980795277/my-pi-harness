import { useCallback, useState, type MouseEvent, type SyntheticEvent } from 'react';
import { API_PREFIX } from '@/constants/api';

interface ImageSelection {
  source: string;
  failed: boolean;
}

interface TraceImageState {
  image: ImageSelection | null;
  indices: number[];
  show: (event: MouseEvent<HTMLButtonElement>) => void;
  close: () => void;
  fail: (event: SyntheticEvent<HTMLImageElement>) => void;
  previous: () => void;
  next: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
}

const IMAGE_PAGE_SIZE = 20;

/** Image URLs are constructed only from validated request identity and explicit numeric selection. */
export const useTraceImage = (
  sessionId: string,
  requestId: string | null,
  itemIndex: number,
  count: number,
): TraceImageState => {
  const [image, setImage] = useState<ImageSelection | null>(null);
  const [page, setPage] = useState(0);
  const start = page * IMAGE_PAGE_SIZE;
  const indices = Array.from(
    { length: Math.min(IMAGE_PAGE_SIZE, Math.max(0, count - start)) },
    (_, index) => {
      return start + index;
    },
  );
  const show = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const index = Number(event.currentTarget.value);
      if (requestId === null || !Number.isInteger(index) || index < 0 || index >= count) return;
      const source =
        API_PREFIX +
        '/sessions/' +
        encodeURIComponent(sessionId) +
        '/trace/requests/' +
        encodeURIComponent(requestId) +
        '/images/' +
        String(itemIndex) +
        '/' +
        String(index);
      setImage({ source, failed: false });
    },
    [count, itemIndex, requestId, sessionId],
  );
  const close = useCallback((): void => {
    setImage(null);
  }, []);
  const fail = useCallback((event: SyntheticEvent<HTMLImageElement>): void => {
    const source = event.currentTarget.getAttribute('src');
    setImage((current) => {
      if (current === null || current.source !== source) return current;
      return { ...current, failed: true };
    });
  }, []);
  const previous = useCallback((): void => {
    setImage(null);
    setPage((current) => {
      return Math.max(0, current - 1);
    });
  }, []);
  const next = useCallback((): void => {
    if (start + IMAGE_PAGE_SIZE >= count) return;
    setImage(null);
    setPage((current) => {
      return current + 1;
    });
  }, [count, start]);
  return {
    image,
    indices,
    show,
    close,
    fail,
    previous,
    next,
    hasPrevious: page > 0,
    hasNext: start + IMAGE_PAGE_SIZE < count,
  };
};
