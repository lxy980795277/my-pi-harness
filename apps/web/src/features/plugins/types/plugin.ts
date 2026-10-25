import type { PluginView } from '@my-pi-harness/protocol';
import type { Action } from '@/types/events';
export type PluginAction = 'install' | 'toggle' | 'remove' | 'component';
export type PluginCategoryFilter = 'all' | 'services' | 'office';
export interface PluginSettingsRow {
  plugin: PluginView;
  install: Action;
  toggle: Action;
  remove: Action;
  components: {
    id: string;
    label: string;
    enabled: boolean;
    change: Action;
    isApp: boolean;
    status: string;
    manage: Action;
    connections: Action;
  }[];
}
export interface PluginSettingsState {
  rows: PluginSettingsRow[];
  loading: boolean;
  error: string | null;
  pending: boolean;
  category: PluginCategoryFilter;
  changeCategory: (value: string) => void;
  options: { value: string; label: string }[];
}
