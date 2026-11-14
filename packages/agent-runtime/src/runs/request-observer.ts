import { randomUUID } from 'node:crypto';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { ModelRequestPurpose } from '@my-pi-harness/protocol';
import type { ModelRequestCompleted, ModelRequestStarted } from '@my-pi-harness/protocol/internal';
import type { EventInput } from '../sessions/ports';
import { runFailureMessage } from './failure';
import { messageUsage } from './message-usage';
import { RuntimeError } from '../errors';
import { requestCostEstimate, requestPriceSnapshot } from './request-pricing';

/** The owning execution supplies identity and commits; the provider supplies only its result. */
export interface RequestObservation {
  branchId: string;
  runId: string | null;
  providerId: string;
  purpose: ModelRequestPurpose;
  priceSource?: 'pi-catalog';
  inputMessageId(): string | null;
  answerInputMessageId?(): string | null;
  commit(events: readonly EventInput[]): void;
  prepare?(modelRequestId: string): void;
}

/** Auxiliary model fallbacks must propagate a failed durable audit instead of hiding it. */
export class RequestAuditError extends RuntimeError {
  public constructor(cause: unknown) {
    super('MODEL_AUDIT_FAILED', '模型请求记录保存失败。', { cause });
  }
}

/** Time the first observable SDK response, including a resolved terminal, without claiming network delivery. */
export function observedRequest(
  stream: StreamFn,
  observation: RequestObservation | undefined,
  queuedAt: number,
  queueDurationMs = 0,
): StreamFn {
  if (!observation) return stream;
  return async (model, context, options) => {
    const modelRequestId = randomUUID();
    try {
      observation.prepare?.(modelRequestId);
    } catch (error) {
      throw new RequestAuditError(error);
    }
    const startedAt = Date.now();
    const priceSnapshot = requestPriceSnapshot(model, observation.priceSource);
    const monotonicStart = performance.now();
    let firstResponseMs: number | null = null;
    const firstResponse = (): void => {
      firstResponseMs ??= Math.max(0, Math.round(performance.now() - monotonicStart));
    };
    const start: ModelRequestStarted = {
      modelRequestId,
      branchId: observation.branchId,
      purpose: observation.purpose,
      inputMessageId: observation.inputMessageId(),
      answerInputMessageId: observation.answerInputMessageId?.() ?? null,
      providerId: observation.providerId,
      modelId: model.id,
      queuedAt,
      queueDurationMs,
      startedAt,
    };
    const commit = (events: readonly EventInput[]): void => {
      try {
        observation.commit(events);
      } catch (error) {
        throw new RequestAuditError(error);
      }
    };
    commit([
      {
        type: 'model.request.started',
        runId: observation.runId,
        at: startedAt,
        data: start,
        privateData: { priceSnapshot },
      },
    ]);
    const finish = (result: AssistantMessage | undefined, cause?: unknown): void => {
      const usage = result ? messageUsage(result.usage) : undefined;
      const costEstimate =
        usage && result ? requestCostEstimate(model, priceSnapshot, result.usage) : undefined;
      const failed =
        result === undefined ||
        result.stopReason === 'error' ||
        result.stopReason === 'pending' ||
        result.stopReason === 'deferred';
      const cancelled =
        result?.stopReason === 'aborted' || (result === undefined && options?.signal?.aborted);
      const status = cancelled ? 'cancelled' : failed ? 'failed' : 'completed';
      const terminal: ModelRequestCompleted = {
        modelRequestId,
        status,
        finishedAt: Date.now(),
        durationMs: Math.max(0, Math.round(performance.now() - monotonicStart)),
        firstResponseMs,
        error:
          status === 'failed'
            ? result
              ? runFailureMessage({ kind: 'model', message: result.errorMessage })
              : runFailureMessage({ kind: 'owned', cause })
            : null,
        ...(usage ? { usage } : {}),
        ...(usage && result?.usage.cacheWrite1h !== undefined
          ? { cacheWrite1h: result.usage.cacheWrite1h }
          : {}),
        ...(costEstimate ? { costEstimate } : {}),
        // Long upstream identifiers stay in the private SDK codec, not in this bounded DTO.
        ...(result?.responseId && result.responseId.length <= 160
          ? { responseId: result.responseId }
          : {}),
      };
      commit([
        {
          type: 'model.request.completed',
          runId: observation.runId,
          at: terminal.finishedAt,
          data: terminal,
        },
      ]);
    };
    let result: Awaited<ReturnType<StreamFn>>;
    try {
      result = await stream(model, context, {
        ...options,
        onResponse: async (response, responseModel) => {
          firstResponse();
          await options?.onResponse?.(response, responseModel);
        },
      });
    } catch (error) {
      finish(undefined, error);
      throw error;
    }
    const iterate = result[Symbol.asyncIterator].bind(result);
    result[Symbol.asyncIterator] = async function* () {
      for await (const event of { [Symbol.asyncIterator]: iterate }) {
        // A provider may emit its local start event before receiving any network response.
        if (event.type !== 'start') firstResponse();
        yield event;
      }
    };
    const completion = result.result().then(
      (message) => {
        firstResponse();
        finish(message);
        return message;
      },
      (error: unknown) => {
        finish(undefined, error);
        throw error;
      },
    );
    result.result = () => completion;
    return result;
  };
}
