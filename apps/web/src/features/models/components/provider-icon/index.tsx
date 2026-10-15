import { Network } from 'lucide-react';
import type { FC } from 'react';

import { PROVIDER_LOGOS, getProviderLogoClass } from '@/features/models/utils/provider-logos';

interface ProviderIconProps {
  providerId: string | null;
}

/** Brand logos distinguish native providers; custom endpoints use a neutral network glyph. */
export const ProviderIcon: FC<ProviderIconProps> = ({ providerId }) => {
  let source: string | undefined;
  if (providerId !== null) {
    source = PROVIDER_LOGOS[providerId];
  }
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
      {source && (
        <img
          src={source}
          width={22}
          height={22}
          alt=""
          aria-hidden
          className={getProviderLogoClass(providerId)}
        />
      )}
      {!source && (
        <Network
          width={22}
          height={22}
          strokeWidth={1.5}
          aria-hidden
          className="text-muted-foreground"
        />
      )}
    </span>
  );
};
