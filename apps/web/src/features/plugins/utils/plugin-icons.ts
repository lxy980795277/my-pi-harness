import github from '@lobehub/icons-static-svg/icons/github.svg';
import google from '@lobehub/icons-static-svg/icons/google-color.svg';
import notion from '@lobehub/icons-static-svg/icons/notion.svg';
import vercel from '@lobehub/icons-static-svg/icons/vercel.svg';
import { Database, FileText, FileType, Presentation, Puzzle, Sheet } from 'lucide-react';
import type { PluginIconDefinition, PluginIconSize } from '@/features/plugins/types/plugin-icon';

const PLUGIN_ICONS: Readonly<Record<string, PluginIconDefinition>> = {
  github: { kind: 'brand', source: github, monochrome: true },
  google: { kind: 'brand', source: google, monochrome: false },
  vercel: { kind: 'brand', source: vercel, monochrome: true },
  notion: { kind: 'brand', source: notion, monochrome: true },
  supabase: { kind: 'symbol', Icon: Database },
  documents: { kind: 'symbol', Icon: FileText },
  pdf: { kind: 'symbol', Icon: FileType },
  spreadsheets: { kind: 'symbol', Icon: Sheet },
  presentations: { kind: 'symbol', Icon: Presentation },
};

const FALLBACK_ICON: PluginIconDefinition = { kind: 'symbol', Icon: Puzzle };

/** Resolves installed brand assets and office symbols without loading remote images. */
export const resolvePluginIcon = (id: string): PluginIconDefinition => {
  const definition = PLUGIN_ICONS[id];
  if (definition) {
    return definition;
  }
  return FALLBACK_ICON;
};

/** Detail views use a larger container and mark while retaining the same visual treatment. */
export const getPluginIconSize = (large: boolean): PluginIconSize => {
  if (large) {
    return {
      containerClass:
        'flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-muted text-foreground',
      dimension: 32,
    };
  }
  return {
    containerClass:
      'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground',
    dimension: 24,
  };
};

/** Only monochrome logos invert in the dark theme. */
export const getPluginLogoClass = (monochrome: boolean): string => {
  if (monochrome) {
    return 'object-contain dark:invert';
  }
  return 'object-contain';
};
