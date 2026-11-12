import type { Virtualizer } from '@tanstack/react-virtual';
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useTimelineStore } from '@/features/sessions/stores/timeline';
import type { TimelineEntry } from '@/features/sessions/types/session';
import type { TimelineSeekState } from '@/features/sessions/types/timeline-target';
import { timelineMessageLocation } from '@/features/sessions/utils/timeline-target';

/** Mounted message refs refine a stable virtual-row jump; no lookup assumes offscreen DOM exists. */
export const useTimelineSeek = (
  sessionId: string,
  branchId: string,
  entries: readonly TimelineEntry[],
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>,
  viewport: RefObject<HTMLDivElement | null>,
  changeLocating: (active: boolean) => void,
): TimelineSeekState => {
  const target = useTimelineStore((state) => {
    return state.targets[sessionId];
  });
  const clear = useTimelineStore((state) => {
    return state.clearTarget;
  });
  const expand = useTimelineStore((state) => {
    return state.setProcessExpanded;
  });
  const nodes = useRef(new Map<string, HTMLElement>());
  const locating = useRef(false);
  const [error, setError] = useState<string | null>(null);
  let location = null;
  if (target !== undefined) location = timelineMessageLocation(entries, target.messageId);
  const index = location?.index ?? -1;
  const processInputId = location?.processInputId ?? null;
  const registerMessage = useCallback((id: string, node: HTMLElement | null): void => {
    if (node === null) nodes.current.delete(id);
    else nodes.current.set(id, node);
  }, []);
  const cancel = useCallback((): void => {
    if (target !== undefined) clear(sessionId, target.id);
    locating.current = false;
    changeLocating(false);
  }, [changeLocating, clear, sessionId, target]);
  useLayoutEffect(() => {
    if (target === undefined) return;
    if (target.branchId !== branchId) {
      clear(sessionId, target.id);
      return;
    }
    if (index < 0) {
      setError('原消息不在当前对话窗口中，请使用搜索中的只读来源查看。');
      clear(sessionId, target.id);
      return;
    }
    setError(null);
    locating.current = true;
    changeLocating(true);
    if (processInputId !== null) expand(sessionId, processInputId, true);
    virtualizer.scrollToIndex(index, { align: 'start', behavior: 'auto' });
    let frame = 0;
    let attempts = 0;
    const calibrate = (): void => {
      attempts += 1;
      const node = nodes.current.get(target.messageId);
      const container = viewport.current;
      if (node !== undefined && container !== null) {
        const delta = node.getBoundingClientRect().top - container.getBoundingClientRect().top - 16;
        if (Math.abs(delta) > 2) virtualizer.scrollBy(delta, { behavior: 'auto' });
      }
      if (attempts < 6) {
        frame = requestAnimationFrame(calibrate);
        return;
      }
      if (node === undefined) setError('原消息未能完成定位，请使用搜索中的只读来源查看。');
      locating.current = false;
      changeLocating(false);
      clear(sessionId, target.id);
    };
    frame = requestAnimationFrame(calibrate);
    return (): void => {
      cancelAnimationFrame(frame);
      locating.current = false;
    };
  }, [
    branchId,
    changeLocating,
    clear,
    expand,
    index,
    processInputId,
    sessionId,
    target,
    viewport,
    virtualizer,
  ]);
  return { registerMessage, locating, error, cancel };
};
