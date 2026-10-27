import type { PluginSkillPreview, PluginView, RemoteMcpView } from '@my-pi-harness/protocol';
import type { Action } from '@/types/events';

export type PluginAction = 'install' | 'toggle' | 'remove' | 'component';
export type PluginCategoryFilter = 'all' | 'services' | 'office';
export type PluginPage =
  | { type: 'market' }
  | { type: 'plugin'; pluginId: string }
  | { type: 'skill'; pluginId: string; skillName: string }
  | { type: 'app'; pluginId: string; appId: string };
export interface PluginSettingsRow {
  plugin: PluginView;
  open: Action;
  install: Action;
  toggle: Action;
  remove: Action;
}
export interface PluginSkillRow extends PluginSkillPreview {
  enabled: boolean;
  disabled: boolean;
  open: Action;
  change: Action;
}
export interface PluginAppRow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  disabled: boolean;
  status: string;
  server: RemoteMcpView | null;
  usesPluginOAuth: boolean;
  open: Action;
  change: Action;
}
export interface PluginSettingsState {
  rows: PluginSettingsRow[];
  selected: PluginSettingsRow | null;
  apps: PluginAppRow[];
  skills: PluginSkillRow[];
  activeSkill: PluginSkillRow | null;
  activeApp: PluginAppRow | null;
  page: PluginPage;
  pageKey: string;
  pageLabel: string;
  backLabel: string;
  back: Action;
  mountPage: (element: HTMLElement | null) => void;
  loading: boolean;
  error: string | null;
  retry: Action;
  pending: boolean;
  category: PluginCategoryFilter;
  changeCategory: (value: string) => void;
  options: { value: string; label: string }[];
}
