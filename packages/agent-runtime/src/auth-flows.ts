import { randomUUID } from 'node:crypto';
import type { AuthEvent, AuthPrompt, AuthType, MutableModels } from '@earendil-works/pi-ai';
import type { AuthFlow } from '@my-pi-harness/protocol';
import { abortError, RuntimeError } from './errors.js';

interface PendingPrompt {
  id: string;
  type: NonNullable<AuthFlow['prompt']>['type'];
  resolve(value: string): void;
  reject(error: Error): void;
  cleanup(): void;
  options: readonly string[] | undefined;
}
interface OwnedFlow {
  view: AuthFlow;
  controller: AbortController;
  pending: PendingPrompt | undefined;
  task: Promise<void>;
  timeout: ReturnType<typeof setTimeout>;
  settling: boolean;
}

/** Authorized UI polls these interactions; secrets exist only in the pending response. */
export class AuthFlows {
  private readonly flows = new Map<string, OwnedFlow>();
  private closed = false;

  public constructor(
    private readonly models: MutableModels,
    private readonly deviceId?: string,
  ) {}

  public isActive(providerId: string): boolean {
    return [...this.flows.values()].some(
      ({ view, settling }) => view.providerId === providerId && settling,
    );
  }

  public start(providerId: string, kind: AuthType): AuthFlow {
    if (this.closed) throw new RuntimeError('RUNTIME_CLOSED', 'Runtime is closing');
    if (this.isActive(providerId))
      throw new RuntimeError('AUTH_BUSY', 'An authentication flow is already active');
    if (this.flows.size >= 128) {
      for (const [id, flow] of this.flows) {
        if (flow.view.status !== 'pending' && !flow.settling) this.flows.delete(id);
      }
      if (this.flows.size >= 128)
        throw new RuntimeError('AUTH_LIMIT', 'Too many authentication flows');
    }
    const id = randomUUID();
    const controller = new AbortController();
    const flow: OwnedFlow = {
      view: {
        id,
        providerId,
        status: 'pending',
        url: null,
        deviceCode: null,
        prompt: null,
        message: null,
        error: null,
      },
      controller,
      pending: undefined,
      task: Promise.resolve(),
      timeout: setTimeout(() => {
        this.cancel(id);
      }, 10 * 60_000),
      settling: true,
    };
    flow.timeout.unref();
    this.flows.set(id, flow);
    const deviceId = this.deviceId;
    flow.task = this.models
      .login(
        providerId,
        kind,
        {
          signal: controller.signal,
          prompt: (prompt) => this.prompt(flow, prompt),
          notify: (event) => this.notify(flow, event),
        },
        { agentName: 'My Pi Harness', ...(deviceId ? { getDeviceId: () => deviceId } : {}) },
      )
      .then(
        () => {
          if (!controller.signal.aborted) flow.view.status = 'completed';
        },
        () => {
          flow.view.status = controller.signal.aborted ? 'cancelled' : 'failed';
          flow.view.error = controller.signal.aborted
            ? null
            : 'Authentication failed. Check the provider and try again.';
        },
      )
      .finally(() => {
        flow.settling = false;
        clearTimeout(flow.timeout);
        flow.pending?.reject(abortError());
        flow.pending?.cleanup();
        flow.pending = undefined;
        flow.view.prompt = null;
      });
    return structuredClone(flow.view);
  }

  public get(id: string): AuthFlow {
    return structuredClone(this.require(id).view);
  }

  public list(): AuthFlow[] {
    return [...this.flows.values()].map(({ view }) => structuredClone(view));
  }

  public respond(id: string, promptId: string, value: string): AuthFlow {
    const flow = this.require(id);
    const pending = flow.pending;
    if (flow.view.status !== 'pending' || pending?.id !== promptId) {
      throw new RuntimeError('AUTH_PROMPT_EXPIRED', 'Authentication prompt is no longer active');
    }
    if (pending.options && !pending.options.includes(value)) {
      throw new RuntimeError('AUTH_OPTION_INVALID', 'Authentication option is not available');
    }
    if (pending.type !== 'text' && value.length === 0)
      throw new RuntimeError('AUTH_RESPONSE_REQUIRED', 'Authentication response cannot be empty');
    pending.cleanup();
    flow.pending = undefined;
    flow.view.prompt = null;
    pending.resolve(value);
    return structuredClone(flow.view);
  }

  public cancel(id: string): AuthFlow {
    const flow = this.require(id);
    if (flow.view.status === 'pending') {
      flow.view.status = 'cancelled';
      flow.controller.abort(abortError());
    }
    return structuredClone(flow.view);
  }

  public async close(): Promise<void> {
    this.closed = true;
    for (const [id, flow] of this.flows) {
      clearTimeout(flow.timeout);
      if (flow.view.status === 'pending') this.cancel(id);
    }
    await Promise.all([...this.flows.values()].map(({ task }) => task));
    this.flows.clear();
  }

  private require(id: string): OwnedFlow {
    const flow = this.flows.get(id);
    if (!flow) throw new RuntimeError('AUTH_NOT_FOUND', 'Authentication flow does not exist');
    return flow;
  }

  private notify(flow: OwnedFlow, event: AuthEvent): void {
    if (flow.controller.signal.aborted) return;
    switch (event.type) {
      case 'auth_url':
        flow.view.url = event.url;
        flow.view.message = event.instructions ?? null;
        break;
      case 'device_code':
        flow.view.url = event.verificationUri;
        flow.view.deviceCode = event.userCode;
        break;
      case 'info': {
        flow.view.message = event.message;
        const firstLink = event.links?.[0];
        if (firstLink !== undefined) flow.view.url = firstLink.url;
        break;
      }
      case 'progress':
        flow.view.message = event.message;
        break;
    }
  }

  private prompt(flow: OwnedFlow, prompt: AuthPrompt): Promise<string> {
    flow.controller.signal.throwIfAborted();
    prompt.signal?.throwIfAborted();
    if (flow.pending)
      throw new RuntimeError('AUTH_PROMPT_BUSY', 'Authentication has an unanswered prompt');
    const id = randomUUID();
    flow.view.prompt = {
      id,
      type: prompt.type,
      message: prompt.message,
      secret: prompt.type === 'secret',
      ...('placeholder' in prompt && prompt.placeholder !== undefined
        ? { placeholder: prompt.placeholder }
        : {}),
      ...(prompt.type === 'select'
        ? {
            options: prompt.options.map(({ id: optionId, label, description }) => ({
              id: optionId,
              label,
              ...(description === undefined ? {} : { description }),
            })),
          }
        : {}),
    };
    return new Promise<string>((resolve, reject) => {
      const cleanup = (): void => {
        flow.controller.signal.removeEventListener('abort', cancel);
        prompt.signal?.removeEventListener('abort', cancel);
      };
      const cancel = (): void => {
        cleanup();
        flow.pending = undefined;
        flow.view.prompt = null;
        reject(abortError());
      };
      flow.pending = {
        id,
        type: prompt.type,
        resolve,
        reject,
        cleanup,
        options: prompt.type === 'select' ? prompt.options.map((option) => option.id) : undefined,
      };
      flow.controller.signal.addEventListener('abort', cancel, { once: true });
      prompt.signal?.addEventListener('abort', cancel, { once: true });
    });
  }
}
