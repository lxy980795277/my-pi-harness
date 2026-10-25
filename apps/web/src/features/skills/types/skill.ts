import type { SkillSelection, SkillView, SkillDetail } from '@my-pi-harness/protocol';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ChangeEventHandler } from 'react';
import type { Action, ValueChange } from '@/types/events';
export type SkillSettingsAction = 'save' | 'toggle' | 'remove' | 'resource' | 'directory';
export type SkillFormMode = 'create' | 'install' | 'closed';
export interface SkillDraft {
  name: string;
  description: string;
  content: string;
  owner: string;
  repository: string;
  ref: string;
  path: string;
}
export interface SkillSelectionState {
  selected: SkillSelection[];
  rows: { skill: SkillView; selected: boolean; disabled: boolean; change: Action }[];
  open: boolean;
  changeOpen: ValueChange<boolean>;
  openPicker: Action;
  loading: boolean;
  error: string | null;
  blocked: boolean;
  invalid: SkillSelection[];
  removeInvalid: Action;
  locked: boolean;
}
export interface SkillPickerProps {
  state: SkillSelectionState;
}

export interface SkillsSettingsState {
  catalog: UseQueryResult<SkillView[], Error>;
  detail: UseQueryResult<SkillDetail, Error>;
  rows: {
    skill: SkillView;
    show: Action;
    directory: Action;
    toggle: Action;
    remove: Action;
    canRemove: boolean;
    canToggle: boolean;
  }[];
  directoryLabel: string;
  resources: { path: string; size: number; open: Action }[];
  resourceText: string | null;
  resourceImage: string | null;
  mode: SkillFormMode;
  draft: SkillDraft;
  workspace: string;
  workspaceOptions: { value: string; label: string }[];
  changeWorkspace: ValueChange<string>;
  changeField: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  create: Action;
  install: Action;
  closeForm: Action;
  save: Action;
  pending: boolean;
  error: string | null;
}
