import type {
  SearchIndexStatus,
  SearchModelStatus,
  SearchRerankerStatus,
} from '@my-pi-harness/protocol';
import type { UseQueryResult } from '@tanstack/react-query';
import type { AsyncEvent } from '@/hooks/use-async-event';
import type { Action } from '@/types/events';

export type SearchResourceAction =
  | 'prepare'
  | 'cancel'
  | 'prepare-reranker'
  | 'cancel-reranker'
  | 'rebuild'
  | 'refresh';
export type SearchResourceTone = 'secondary' | 'success' | 'warning' | 'error';
export type SearchLocalModelStatus = SearchModelStatus | SearchRerankerStatus;
export type SearchModelKind = 'embedding' | 'reranker';

export interface SearchModelResourceProps {
  title: string;
  view: SearchModelView;
  pending: boolean;
  onPrepare: Action;
  onCancel: Action;
}

export interface SearchModelView {
  label: string;
  tone: SearchResourceTone;
  description: string;
  progressLabel: string | null;
  error: string | null;
  canPrepare: boolean;
  prepareLabel: string;
  canCancel: boolean;
}

export interface SearchIndexView {
  label: string;
  tone: SearchResourceTone;
  lexicalLabel: string;
  coverageLabel: string;
  pendingLabel: string | null;
  rebuilding: boolean;
}

export interface SearchResourcesState {
  model: UseQueryResult<SearchModelStatus, Error>;
  reranker: UseQueryResult<SearchRerankerStatus, Error>;
  index: UseQueryResult<SearchIndexStatus, Error>;
  modelView: SearchModelView | null;
  rerankerView: SearchModelView | null;
  indexView: SearchIndexView | null;
  command: AsyncEvent<[SearchResourceAction]>;
  prepare: Action;
  cancel: Action;
  prepareReranker: Action;
  cancelReranker: Action;
  rebuild: Action;
  refresh: Action;
}
