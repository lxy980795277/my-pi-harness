import { useCallback } from 'react';
import type { MouseEvent } from 'react';

import { useAsyncEvent } from '@/hooks/use-async-event';
import { openExternal } from '@/services/open-external';

import { getMarkdownUrl } from '../markdown-url';
import type { MarkdownLinkState } from '../types';

/** Keep real hrefs for assistive technology while desktop navigation uses its restricted bridge. */
export const useMarkdownLink = (href: string | undefined): MarkdownLinkState => {
  const url = getMarkdownUrl(href);
  const open = useCallback(async (): Promise<void> => {
    if (url !== undefined) {
      await openExternal(url);
    }
  }, [url]);
  const event = useAsyncEvent(open);
  const handleClick = (click: MouseEvent<HTMLAnchorElement>): void => {
    if (click.defaultPrevented || click.button !== 0) {
      return;
    }
    click.preventDefault();
    event.run();
  };
  return { url, handleClick, error: event.error };
};
