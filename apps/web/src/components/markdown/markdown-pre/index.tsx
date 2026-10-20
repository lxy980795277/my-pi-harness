import type { FC } from 'react';

import { MarkdownCodeBlock } from '../code-block';
import { getMarkdownCode } from '../code-data';
import type { MarkdownPreProps } from '../types';

export const MarkdownPre: FC<MarkdownPreProps> = ({ children }) => {
  const block = getMarkdownCode(children);
  return <MarkdownCodeBlock code={block.code} language={block.language} />;
};
