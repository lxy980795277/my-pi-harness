import { Sparkles } from 'lucide-react';
import type { FC } from 'react';
import { getProviderLogoClass, PROVIDER_LOGOS } from '@/features/models/utils/provider-logos';
import { cn } from '@/utils/cn';

interface ModelMenuIconProps {
  builtinId: string | null;
}

/** Compact provider marks use the same approved assets as model settings. */
export const ModelMenuIcon: FC<ModelMenuIconProps> = ({ builtinId }) => {
  let source: string | undefined;
  if (builtinId !== null) source = PROVIDER_LOGOS[builtinId];
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
      {source && (
        <img
          src={source}
          alt=""
          width={16}
          height={16}
          className={cn(getProviderLogoClass(builtinId), 'size-4')}
        />
      )}
      {!source && <Sparkles width={16} height={16} aria-hidden />}
    </span>
  );
};
