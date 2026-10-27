import { randomUUID } from 'node:crypto';
import type {
  Plan,
  PlanReview,
  PlanStep,
  QuestionItem,
  QuestionResponse,
} from '@my-pi-harness/protocol';
import { RuntimeError } from '../errors.js';
import type { WorkRuntime } from './runtime.js';

interface Pending<T> {
  sessionId: string;
  settle(value: T): void;
}

/** One Run owns each suspended tool; durable state records its visible question or plan review. */
export class WorkInteractions {
  private readonly questions = new Map<string, Pending<QuestionResponse[] | null>>();
  private readonly plans = new Map<string, Pending<PlanReview>>();
  public constructor(private readonly work: WorkRuntime) {}

  public answer(sessionId: string, id: string, answers: QuestionResponse[] | null): void {
    const state = this.work.snapshot(sessionId).state;
    const question = state.questions.find((entry) => entry.id === id);
    const pending = this.questions.get(id);
    if (!question || question.status !== 'pending' || pending?.sessionId !== sessionId)
      throw new RuntimeError('QUESTION_CONFLICT', '该问题已结束或不属于当前等待。');
    if (answers !== null) {
      if (
        answers.length !== question.questions.length ||
        new Set(answers.map(({ questionId }) => questionId)).size !== answers.length
      )
        throw new RuntimeError('QUESTION_INVALID', '请完整回答每个问题。');
      for (const item of question.questions) {
        const answer = answers.find(({ questionId }) => questionId === item.id);
        if (
          !answer ||
          (!item.multiSelect && answer.optionIds.length > 1) ||
          new Set(answer.optionIds).size !== answer.optionIds.length ||
          answer.optionIds.some((id) => !item.options.some((option) => option.id === id)) ||
          (!item.allowCustomInput && answer.text.trim().length > 0) ||
          (answer.optionIds.length === 0 && answer.text.trim().length === 0)
        )
          throw new RuntimeError('QUESTION_INVALID', '回答不符合问题的选项或输入要求。');
      }
    }
    this.work.save(
      sessionId,
      {
        ...state,
        questions: state.questions.map((entry) =>
          entry.id === id
            ? { ...entry, status: answers === null ? 'cancelled' : 'answered', answers }
            : entry,
        ),
      },
      question.runId,
    );
    pending.settle(answers);
  }

  public async ask(
    sessionId: string,
    runId: string,
    toolCallId: string,
    questions: QuestionItem[],
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted();
    if (
      new Set(questions.map(({ id }) => id)).size !== questions.length ||
      questions.some(
        (item) =>
          new Set(item.options.map(({ id }) => id)).size !== item.options.length ||
          (item.options.length === 0 && !item.allowCustomInput),
      )
    )
      throw new RuntimeError('QUESTION_INVALID', '问题ID和选项必须唯一，并提供至少一种回答方式。');
    const state = this.work.snapshot(sessionId).state;
    if (state.questions.length >= 100)
      throw new RuntimeError('QUESTION_LIMIT', '本分支问题数量达到上限。');
    const id = randomUUID();
    this.work.save(
      sessionId,
      {
        ...state,
        questions: [
          ...state.questions,
          {
            id,
            runId,
            branchId: state.branchId,
            toolCallId,
            questions,
            status: 'pending',
            answers: null,
            createdAt: Date.now(),
          },
        ],
      },
      runId,
    );
    try {
      const answers = await this.wait(this.questions, sessionId, id, signal);
      if (answers === null) throw new RuntimeError('QUESTION_CANCELLED', '用户取消了问题。');
      return JSON.stringify({ answers });
    } finally {
      const latest = this.work.snapshot(sessionId).state;
      if (latest.questions.some((question) => question.id === id && question.status === 'pending'))
        this.work.save(
          sessionId,
          {
            ...latest,
            questions: latest.questions.map((question) =>
              question.id === id ? { ...question, status: 'cancelled' } : question,
            ),
          },
          runId,
        );
    }
  }

  public review(sessionId: string, planId: string, input: PlanReview): void {
    const state = this.work.snapshot(sessionId).state;
    const pending = this.plans.get(planId);
    if (
      state.plan?.id !== planId ||
      state.plan.review !== 'pending' ||
      pending?.sessionId !== sessionId
    )
      throw new RuntimeError('PLAN_CONFLICT', '该计划当前没有等待审核。');
    if (input.decision === 'feedback' && input.feedback.trim().length === 0)
      throw new RuntimeError('PLAN_FEEDBACK_REQUIRED', '请填写需要调整的内容。');
    const approved = input.decision === 'approve';
    this.work.save(
      sessionId,
      {
        ...state,
        mode: approved ? 'execute' : 'plan',
        plan: {
          ...state.plan,
          status: approved ? 'approved' : 'draft',
          review: approved ? 'approved' : input.decision === 'feedback' ? 'feedback' : 'cancelled',
          feedback: input.feedback.trim() || null,
          updatedAt: Date.now(),
        },
      },
      state.plan.runId,
    );
    pending.settle(input);
  }

  public async propose(
    sessionId: string,
    runId: string,
    title: string,
    content: string,
    steps: PlanStep[],
    signal: AbortSignal,
  ): Promise<string> {
    if (
      steps.length === 0 ||
      new Set(steps.map(({ id }) => id)).size !== steps.length ||
      steps.filter(({ status }) => status === 'in_progress').length > 1
    )
      throw new RuntimeError('PLAN_INVALID', '计划需要唯一的步骤，且最多一个步骤进行中。');
    const state = this.work.snapshot(sessionId).state;
    if (
      state.todos.some(
        ({ planStepId }) => planStepId !== null && !steps.some((step) => step.id === planStepId),
      )
    )
      throw new RuntimeError(
        'TODO_PLAN_STEP_INVALID',
        '新计划缺少任务关联的步骤，请先更新或清理任务关联。',
      );
    const id = randomUUID();
    const plan: Plan = {
      id,
      runId,
      title,
      content,
      steps,
      status: 'draft',
      review: 'pending',
      feedback: null,
      updatedAt: Date.now(),
    };
    this.work.save(sessionId, { ...state, mode: 'plan', plan }, runId);
    try {
      const response = await this.wait(this.plans, sessionId, id, signal);
      if (response.decision === 'approve')
        return '用户已批准该计划。继续同一次运行，逐项执行；每项工具仍遵守正常审批策略。';
      if (response.decision === 'feedback')
        return `用户要求修改计划：${response.feedback}。保持规划模式，修订后重新提交审核。`;
      return '用户取消了计划审核。保持规划模式，不执行文件修改或命令。';
    } finally {
      const latest = this.work.snapshot(sessionId).state;
      if (latest.plan?.id === id && latest.plan.review === 'pending')
        this.work.save(
          sessionId,
          { ...latest, plan: { ...latest.plan, review: 'cancelled', updatedAt: Date.now() } },
          runId,
        );
    }
  }

  private async wait<T>(
    map: Map<string, Pending<T>>,
    sessionId: string,
    id: string,
    signal: AbortSignal,
  ): Promise<T> {
    let cleanup = (): void => undefined;
    try {
      return await new Promise<T>((resolve, reject) => {
        const abort = (): void =>
          reject(new RuntimeError('INTERACTION_CANCELLED', '交互已取消或等待超时。'));
        const timer = setTimeout(abort, 86_400_000);
        cleanup = (): void => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          map.delete(id);
        };
        map.set(id, { sessionId, settle: resolve });
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    } finally {
      cleanup();
    }
  }
}
