import type { FC } from 'react';

import { getMarkdownAlignment } from '../code-data';
import type { MarkdownCellProps } from '../types';

export const MarkdownCell: FC<MarkdownCellProps> = ({ children, style }) => {
  return <td className={getMarkdownAlignment(style)}>{children}</td>;
};
