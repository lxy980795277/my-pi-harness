import { Children, isValidElement } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import type { MarkdownCodeData, MarkdownCodeElementProps } from './types';

/** Read the parser's code child while removing its one structural terminal newline. */
export const getMarkdownCode = (children: ReactNode): MarkdownCodeData => {
  const child = Children.toArray(children)[0];
  if (!isValidElement<MarkdownCodeElementProps>(child)) {
    return { code: '', language: '' };
  }
  const { children: text, className } = child.props;
  let code = '';
  if (typeof text === 'string') {
    code = text;
  }
  if (code.endsWith('\n')) {
    code = code.slice(0, -1);
  }
  let language = '';
  if (className !== undefined) {
    const match = /(?:^|\s)language-([^\s]+)/u.exec(className);
    const identifier = match?.[1];
    if (identifier !== undefined) {
      language = identifier.toLowerCase();
    }
  }
  return { code, language };
};

/** GFM alignment becomes a finite CSS class rather than an inline style under CSP. */
export const getMarkdownAlignment = (style: CSSProperties | undefined): string => {
  if (style?.textAlign === 'right') {
    return 'markdown__cell--right';
  }
  if (style?.textAlign === 'center') {
    return 'markdown__cell--center';
  }
  return 'markdown__cell--left';
};
