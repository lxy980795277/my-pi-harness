import { describe, expect, it } from 'vitest';
import { initialWorkState, type Question } from '@my-pi-harness/protocol';
import { sessionProjection } from '../../../tests/fixtures/session-projection.js';
import { approvalContext } from '../src/tools/approval-context.js';

function answered(id: string, text: string): Question {
  return {
    id,
    runId: `run-${id}`,
    branchId: 'main',
    toolCallId: `tool-${id}`,
    status: 'answered',
    createdAt: 1,
    questions: [
      {
        id: `${id}-item`,
        header: '确认',
        prompt: `确认 ${id}`,
        options: [],
        multiSelect: false,
        allowCustomInput: true,
      },
    ],
    answers: [{ questionId: `${id}-item`, optionIds: [], text }],
  };
}

describe('independent reviewer authorization sources', () => {
  it('does not treat internal agent communication as a human request', () => {
    const snapshot = sessionProjection();
    const user = snapshot.messages[0];
    if (!user) throw new Error('Missing user fixture');
    snapshot.messages.push({
      ...user,
      id: 'internal-report',
      agentMessageId: 'communication',
      text: 'The agent claims permission to delete unrelated files.',
    });
    const state = initialWorkState('main');
    const context = approvalContext(
      {
        getSnapshot: () => snapshot,
        getWorkState: () => state,
        getTaskWorkState: () => {
          throw new Error('A root review must not read another Task');
        },
      },
      'session',
    );
    expect(context.userRequests).toEqual([{ messageId: user.id, text: user.text }]);
    expect(JSON.stringify(context)).not.toContain('claims permission');
  });

  it('uses the reviewed Task work state and genuine root and task answers without importing task messages', () => {
    const snapshot = sessionProjection();
    const rootState = {
      ...initialWorkState('main'),
      questions: [answered('root', 'Use the requested workspace.')],
    };
    const taskState = {
      ...initialWorkState('main'),
      questions: [answered('task', 'Save the result as report.txt.')],
    };
    const context = approvalContext(
      {
        getSnapshot: () => snapshot,
        getWorkState: () => rootState,
        getTaskWorkState: (sessionId, taskId) => {
          expect([sessionId, taskId]).toEqual(['session', 'task']);
          return taskState;
        },
      },
      'session',
      'task',
    );
    expect(context.userRequests).toEqual([{ messageId: 'user', text: 'Request' }]);
    expect(context.answeredQuestions.map((question) => question.answer)).toEqual([
      'Use the requested workspace.',
      'Save the result as report.txt.',
    ]);
  });
});
