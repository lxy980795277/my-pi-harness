import type { FC } from 'react';

import './index.css';

/** Decorative progress dots; the surrounding status owns the accessible announcement. */
export const LoadingDots: FC = () => {
  return (
    <span className="loading-dots" aria-hidden="true">
      <span className="loading-dots__dot" />
      <span className="loading-dots__dot" />
      <span className="loading-dots__dot" />
    </span>
  );
};
