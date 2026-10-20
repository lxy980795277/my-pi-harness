import { memo } from 'react';
import type { FC } from 'react';
import { cjk } from '@streamdown/cjk';
import { defaultRehypePlugins, Streamdown } from 'streamdown';
import type { Components, StreamdownProps } from 'streamdown';

import { cn } from '@/utils/cn';

import { MarkdownCell } from './markdown-cell';
import { MarkdownHeaderCell } from './markdown-header-cell';
import { MarkdownImage } from './markdown-image';
import { MarkdownLink } from './markdown-link';
import { MarkdownPre } from './markdown-pre';
import { MarkdownStrong } from './markdown-strong';
import { MarkdownTable } from './markdown-table';
import { getMarkdownUrl } from './markdown-url';
import type { MarkdownProps } from './types';

import './index.css';

const COMPONENTS: Components = {
  a: MarkdownLink,
  img: MarkdownImage,
  pre: MarkdownPre,
  strong: MarkdownStrong,
  table: MarkdownTable,
  th: MarkdownHeaderCell,
  td: MarkdownCell,
};
const REHYPE_PLUGINS: NonNullable<StreamdownProps['rehypePlugins']> = Object.entries(
  defaultRehypePlugins,
).flatMap(([name, plugin]) => {
  if (name === 'raw') {
    return [];
  }
  return [plugin];
});
const LINK_SAFETY = { enabled: false };
const PLUGINS: NonNullable<StreamdownProps['plugins']> = { cjk };

/** Shared assistant/thinking Markdown with GFM, stable block reuse and no raw HTML execution. */
export const Markdown: FC<MarkdownProps> = memo(({ text, streaming = false, className }) => {
  let mode: StreamdownProps['mode'] = 'static';
  if (streaming) {
    mode = 'streaming';
  }
  return (
    <Streamdown
      className={cn('markdown space-y-0', className)}
      mode={mode}
      isAnimating={streaming}
      components={COMPONENTS}
      plugins={PLUGINS}
      controls={false}
      linkSafety={LINK_SAFETY}
      rehypePlugins={REHYPE_PLUGINS}
      skipHtml
      urlTransform={getMarkdownUrl}
    >
      {text}
    </Streamdown>
  );
});
