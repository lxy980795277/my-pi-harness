import { lazy, type FC } from 'react';

interface ModelsModule {
  default: FC;
}

/** Model settings load on demand inside the already mounted settings dialog. */
const loadModelsPage = async (): Promise<ModelsModule> => {
  const module = await import('@/features/models/components/models-page');
  return { default: module.ModelsPage };
};

export const LazyModelsPage = lazy(loadModelsPage);
