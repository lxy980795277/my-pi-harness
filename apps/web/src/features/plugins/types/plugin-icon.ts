import type { LucideIcon } from 'lucide-react';

export interface PluginIconProps {
  id: string;
  large?: boolean;
}

export type PluginIconDefinition =
  | { kind: 'brand'; source: string; monochrome: boolean }
  | { kind: 'symbol'; Icon: LucideIcon };

export interface PluginIconSize {
  containerClass: string;
  dimension: number;
}
