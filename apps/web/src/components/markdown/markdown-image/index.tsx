import { ImageIcon } from 'lucide-react';
import type { FC } from 'react';

import { MarkdownLink } from '../markdown-link';
import type { MarkdownImageProps } from '../types';

/** Model image references never initiate a remote image request. */
export const MarkdownImage: FC<MarkdownImageProps> = ({ src, alt }) => {
  let href: string | undefined;
  if (typeof src === 'string') {
    href = src;
  }
  let label = alt;
  if (label === undefined || label.length === 0) {
    label = '图片';
  }
  return (
    <span className="markdown__image-reference">
      <ImageIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
      <MarkdownLink href={href}>{label}</MarkdownLink>
    </span>
  );
};
