import type { FC } from 'react';
import type { PluginIconProps } from '@/features/plugins/types/plugin-icon';
import {
  getPluginIconSize,
  getPluginLogoClass,
  resolvePluginIcon,
} from '@/features/plugins/utils/plugin-icons';

/** Decorative plugin marks accompany visible names in catalog and detail views. */
export const PluginIcon: FC<PluginIconProps> = ({ id, large = false }) => {
  const definition = resolvePluginIcon(id);
  const dimensions = getPluginIconSize(large);
  return (
    <span className={dimensions.containerClass} aria-hidden>
      {definition.kind === 'brand' && (
        <img
          src={definition.source}
          alt=""
          width={dimensions.dimension}
          height={dimensions.dimension}
          className={getPluginLogoClass(definition.monochrome)}
        />
      )}
      {definition.kind === 'symbol' && (
        <definition.Icon width={dimensions.dimension} height={dimensions.dimension} aria-hidden />
      )}
    </span>
  );
};
