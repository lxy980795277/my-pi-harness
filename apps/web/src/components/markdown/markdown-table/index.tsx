import type { FC } from 'react';

import type { MarkdownTableProps } from '../types';

/** Wide GFM tables scroll inside the reading column. */
export const MarkdownTable: FC<MarkdownTableProps> = ({ children }) => {
  return (
    <div className="markdown__table-scroll" role="region" aria-label="表格">
      <table>{children}</table>
    </div>
  );
};
