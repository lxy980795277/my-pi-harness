import type { Action } from '@/types/events';

export type ApplicationPreparationStage = 'service' | 'workspace';
export type ApplicationLoadingStage = 'authorization' | ApplicationPreparationStage;

export type ApplicationInitializationState =
  | { status: 'loading'; stage: ApplicationLoadingStage }
  | { status: 'error'; stage: ApplicationPreparationStage; message: string }
  | { status: 'ready' };

export interface ApplicationInitialization {
  state: ApplicationInitializationState;
  retry: Action;
}
