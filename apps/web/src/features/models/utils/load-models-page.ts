import { lazy, type FC } from 'react';

interface ModelsModule {
  default: FC;
}

/** Model settings load on demand inside the already mounted settings dialog. */
export const LazyModelsPage = lazy(async (): Promise<ModelsModule> => {
  const module = await import('@/features/models/components/models-page');
  return { default: module.ModelsPage };
});
