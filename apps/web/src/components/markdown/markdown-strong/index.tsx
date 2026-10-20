import type { ComponentProps, FC } from 'react';
import type { ExtraProps } from 'streamdown';

/** Preserve emphasis semantics instead of the upstream renderer's presentational span. */
export const MarkdownStrong: FC<ComponentProps<'strong'> & ExtraProps> = ({ children }) => {
  return <strong>{children}</strong>;
};
