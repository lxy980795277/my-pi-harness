import type { ModelRowState } from '@/features/models/types/model-view';
import type { ModelDefinition } from '@my-pi-harness/protocol';
import { useCallback, type ChangeEvent } from 'react';

/** Row adapters preserve hidden protocol options while changing the visible capability fields. */
export const useModelRow = (
  model: ModelDefinition,
  update: (model: ModelDefinition) => void,
  remove: (id: string) => void,
  test: (id: string) => void,
): ModelRowState => {
  const changeContext = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      update({ ...model, contextWindow: Number(event.target.value) });
    },
    [model, update],
  );
  const changeTokens = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      update({ ...model, maxTokens: Number(event.target.value) });
    },
    [model, update],
  );
  const changeReasoning = useCallback(
    (value: boolean): void => {
      update({ ...model, reasoning: value });
    },
    [model, update],
  );
  const removeModel = useCallback((): void => {
    remove(model.id);
  }, [model.id, remove]);
  const testModel = useCallback((): void => {
    test(model.id);
  }, [model.id, test]);
  return { changeContext, changeTokens, changeReasoning, removeModel, testModel };
};
