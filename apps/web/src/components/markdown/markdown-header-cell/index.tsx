import type { FC } from 'react';

import { getMarkdownAlignment } from '../code-data';
import type { MarkdownHeaderCellProps } from '../types';

export const MarkdownHeaderCell: FC<MarkdownHeaderCellProps> = ({ children, style }) => {
  return <th className={getMarkdownAlignment(style)}>{children}</th>;
};
