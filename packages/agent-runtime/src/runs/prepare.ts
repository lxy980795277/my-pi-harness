import { randomUUID } from 'node:crypto';
import { getSupportedThinkingLevels, type Message, type UserMessage } from '@earendil-works/pi-ai';
import type {
  AgentMessage,
  InputRequest,
  MessageView,
  MemoryMessageSource,
  RunView,
  SessionSummary,
} from '@my-pi-harness/protocol';
import { activeSkillContext } from '../capabilities/context';
import { communicationMessage } from '../context/agent-message';
import { encodeContextMessage } from '../context/codec';
import { RuntimeError } from '../errors';
import type { ModelGateway, ResolvedModel } from '../models/gateway';
import type { EventInput } from '../sessions/ports';
import type { WorkRuntime } from '../work/runtime';
import { runAcceptanceEvent } from './acceptance';
import { consumedMemorySource } from './memory';

interface RunPreparationInput {
  session: SessionSummary;
  run: RunView;
  resolved: ResolvedModel;
  input: InputRequest;
  basePrompt: string;
  skills: Parameters<typeof runAcceptanceEvent>[0]['skills'];
  sourceBranchId: string;
  messageIds: readonly string[];
  history(): Message[];
  signal: AbortSignal;
  work?: WorkRuntime;
  communication?(): AgentMessage;
  acceptedAt?: number;
}
type AcceptanceMetadata = Pick<
  Parameters<typeof runAcceptanceEvent>[0],
  | 'toolset'
  | 'external'
  | 'candidates'
  | 'diagnostics'
  | 'nativeCandidates'
  | 'skillCandidates'
  | 'skills'
>;
interface PreparedRun {
  memorySource?: MemoryMessageSource;
  history: Message[];
  user: UserMessage;
  systemPrompt: string;
  acceptance(
    metadata: AcceptanceMetadata,
    consumed?: (at: number) => readonly EventInput[],
  ): readonly EventInput[];
}

/** Root and delegated models satisfy the same input and reasoning requirements before acceptance. */
export async function resolveRunModel(
  gateway: Pick<ModelGateway, 'resolve'>,
  session: Pick<SessionSummary, 'providerId' | 'modelId' | 'thinkingLevel'>,
  signal: AbortSignal,
  capabilityError = 'Model does not support the selected thinking level',
): Promise<ResolvedModel> {
  const resolved = await gateway.resolve(session.providerId, session.modelId, signal);
  try {
    signal.throwIfAborted();
    if (
      !resolved.model.input.includes('text') ||
      !getSupportedThinkingLevels(resolved.model).includes(session.thinkingLevel)
    )
      throw new RuntimeError('MODEL_CAPABILITY', capabilityError);
    return resolved;
  } catch (error) {
    resolved.release();
    throw error;
  }
}

/** Prepare scoped input once; the caller retains authority, acceptance timing and lease ownership. */
export async function prepareRun(input: RunPreparationInput): Promise<PreparedRun> {
  const { session, run, resolved } = input;
  const prepared = input.work
    ? await input.work.prepare(
        session,
        input.sourceBranchId,
        input.messageIds,
        input.input,
        resolved,
        input.basePrompt,
        input.signal,
      )
    : undefined;
  input.signal.throwIfAborted();
  const at = input.acceptedAt ?? Date.now();
  let user: UserMessage = prepared
    ? { ...prepared.user, timestamp: at }
    : { role: 'user', content: input.input.text, timestamp: at };
  const communication = input.communication?.();
  if (communication) user = communicationMessage(communication);
  const history = prepared?.history ?? input.history();
  const systemPrompt =
    prepared?.systemPrompt ??
    [input.basePrompt, activeSkillContext(input.skills)].filter(Boolean).join('\n\n');
  const message: MessageView = {
    id: randomUUID(),
    sessionId: session.id,
    branchId: run.branchId,
    runId: run.id,
    role: 'user',
    ...(communication ? { agentMessageId: communication.id } : {}),
    text: input.input.text,
    ...(input.input.mcpTools ? { mcpTools: structuredClone(input.input.mcpTools) } : {}),
    ...(input.input.skills ? { skills: structuredClone(input.input.skills) } : {}),
    ...(input.input.attachmentIds ? { attachmentIds: input.input.attachmentIds } : {}),
    thinking: '',
    createdAt: at,
    status: 'complete',
    stopReason: null,
  };
  const memorySource = run.taskId ? undefined : consumedMemorySource(message);
  return {
    ...(memorySource ? { memorySource } : {}),
    history,
    user,
    systemPrompt,
    acceptance(metadata, consumed = () => []) {
      return [
        ...(prepared
          ? [
              {
                type: 'work.updated',
                runId: null,
                at,
                data: {
                  ...(run.taskId ? { taskId: run.taskId } : {}),
                  state: { ...prepared.state, revision: prepared.state.revision + 1 },
                },
              },
            ]
          : []),
        runAcceptanceEvent({
          ...metadata,
          session,
          run,
          resolved,
          requestId: input.input.requestId,
          systemPrompt,
        }),
        ...consumed(at),
        {
          type: 'message.started',
          runId: run.id,
          at,
          data: message,
          privateData: encodeContextMessage(user, {
            ...(input.input.searchQuotes?.length ? { searchQuotes: input.input.searchQuotes } : {}),
          }),
        },
      ];
    },
  };
}
