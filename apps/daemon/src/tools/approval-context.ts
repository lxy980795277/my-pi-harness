import type { Question, WorkState } from '@my-pi-harness/protocol';
import type { ProfileStore } from '@my-pi-harness/storage';

interface ApprovalContext {
  userRequests: { messageId: string; text: string }[];
  projectInstructions: { path: string; content: string }[];
  savedPlan: WorkState['plan'];
  savedSummary: string | null;
  answeredQuestions: { prompt: string; answer: string }[];
}

/** Build the independent reviewer's context from persisted requests and accepted work state. */
export function approvalContext(
  store: Pick<ProfileStore, 'getSnapshot' | 'getWorkState'>,
  sessionId: string,
): ApprovalContext {
  const snapshot = store.getSnapshot(sessionId);
  const state = store.getWorkState(sessionId, snapshot.session.activeBranchId);
  return {
    userRequests: snapshot.messages
      .filter((message) => message.role === 'user')
      .map(({ id: messageId, text }) => ({ messageId, text })),
    projectInstructions: state.rules.map(({ path, content }) => ({ path, content })),
    savedPlan: state.plan,
    savedSummary: state.compaction?.summary ?? null,
    answeredQuestions: answeredQuestions(state.questions),
  };
}

function answeredQuestions(questions: readonly Question[]) {
  return questions
    .filter((question) => question.status === 'answered')
    .flatMap((request) =>
      request.questions.map((question) => {
        const response = request.answers?.find((answer) => answer.questionId === question.id);
        if (response === undefined) return { prompt: question.prompt, answer: '' };
        const parts = question.options
          .filter((option) => response.optionIds.includes(option.id))
          .map((option) => option.label);
        if (response.text) parts.push(response.text);
        return { prompt: question.prompt, answer: parts.filter(Boolean).join('；') };
      }),
    );
}
