import type { FC } from 'react';

import type { MarkdownLinkProps } from '../types';
import { useMarkdownLink } from './use-markdown-link';

/** Invalid URLs render their labels without an actionable destination. */
export const MarkdownLink: FC<MarkdownLinkProps> = ({ children, href, title }) => {
  const link = useMarkdownLink(href);
  if (link.url === undefined) {
    return <span>{children}</span>;
  }
  return (
    <span>
      <a
        href={link.url}
        title={title}
        target="_blank"
        rel="noopener noreferrer"
        onClick={link.handleClick}
      >
        {children}
      </a>
      {link.error !== null && (
        <span className="ml-2 text-xs text-error-foreground" role="alert">
          无法打开链接
        </span>
      )}
    </span>
  );
};
