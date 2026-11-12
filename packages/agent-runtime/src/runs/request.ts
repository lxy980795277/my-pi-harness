import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { PreparedContext } from '../context/request-context';
import type { RunHooks, RunMemoryPort, RunMemoryRequest } from './ports';
import { RuntimeError } from '../errors';

type RequestAdmission = Pick<RunHooks, 'acquireRequest' | 'trackRequest'>;

export interface RequestDispatch {
  hooks?: RequestAdmission;
  memory?: RunMemoryPort;
  identity: RunMemoryRequest;
  draft(): PreparedContext;
  prepare(): Promise<void>;
  validate(): Promise<void>;
  stream: StreamFn;
  onError(error: unknown): void;
}

/** Hold admission until the provider's actual terminal result, including iterator cancellation. */
export function scheduledStream(
  stream: StreamFn,
  hooks: RequestAdmission | undefined,
  onError: (error: unknown) => void,
): StreamFn {
  return async (model, context, options) => {
    const release = await hooks?.acquireRequest(options?.signal ?? new AbortController().signal);
    try {
      const result = await stream(model, context, options);
      const completion = result.result().then(
        () => release?.(),
        (error: unknown) => {
          release?.();
          onError(error);
        },
      );
      hooks?.trackRequest(completion);
      return result;
    } catch (error) {
      release?.();
      throw error;
    }
  };
}

/** Finalize a fresh local draft only after model admission and immediately before host handoff. */
export function dispatchRequest(owner: RequestDispatch): StreamFn {
  return async (model, context, options) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      owner.identity.signal.throwIfAborted();
      const releaseSlot = await owner.hooks?.acquireRequest(owner.identity.signal);
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        releaseSlot?.();
      };
      let handedOff = false;
      try {
        await owner.validate();
        const draft = owner.draft();
        const memoryCurrent =
          draft.memory === undefined ||
          owner.memory === undefined ||
          owner.memory.isCurrent(owner.identity, draft.memory.fingerprint);
        owner.identity.signal.throwIfAborted();
        if (!memoryCurrent || !draft.isCurrent()) {
          release();
          if (attempt === 2) break;
          // Reprojection may need a summary request, so it cannot own the pending request's slot.
          await owner.prepare();
          continue;
        }
        draft.commit();
        const result = await owner.stream(model, { ...context, messages: draft.messages }, options);
        handedOff = true;
        const completion = result.result().then(
          () => release?.(),
          (error: unknown) => {
            release();
            owner.onError(error);
          },
        );
        owner.hooks?.trackRequest(completion);
        return result;
      } finally {
        if (!handedOff) release();
      }
    }
    throw new RuntimeError(
      'MEMORY_CONTEXT_CHANGED',
      '记忆或工作状态持续变化，请稍后重新发送；可先完成编辑或暂时关闭记忆使用。',
    );
  };
}
