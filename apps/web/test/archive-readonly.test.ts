import type { SessionExecutionAccess } from '@my-pi-harness/protocol';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionProjection } from '../../../tests/fixtures/session-projection';
import { ConversationBody } from '../src/features/sessions/components/conversation-body';

const owned = vi.hoisted(() => {
  return {
    access: undefined as SessionExecutionAccess | undefined,
    canEdit: undefined as boolean | undefined,
  };
});
vi.mock('@tanstack/react-query', () => {
  return {
    useQuery: () => {
      return {
        data: owned.access,
        isPending: owned.access === undefined,
        isError: false,
        refetch: vi.fn(),
      };
    },
  };
});
vi.mock('../src/features/work/hooks/use-work', () => {
  return {
    useWork: () => {
      return {};
    },
  };
});
vi.mock('../src/features/sessions/components/message-timeline', () => {
  return {
    MessageTimeline: (props: { canEdit: boolean; children: ReactNode }) => {
      owned.canEdit = props.canEdit;
      return createElement('main', null, 'recorded historical text', props.children);
    },
  };
});
vi.mock('../src/features/sessions/components/composer', () => {
  return {
    Composer: () => {
      return createElement('div', null, 'execution composer');
    },
  };
});
vi.mock('../src/features/work/components/work-requests', () => {
  return {
    WorkRequests: () => {
      return createElement('div', null, 'pending interaction controls');
    },
  };
});
vi.mock('../src/features/work/components/work-panel', () => {
  return {
    WorkPanel: (props: { children: ReactNode }) => {
      return props.children;
    },
  };
});

beforeEach(() => {
  owned.access = undefined;
  owned.canEdit = undefined;
});

const render = (): string => {
  const commands = {
    send: vi.fn(),
    stop: vi.fn(),
    patch: vi.fn(),
    edit: vi.fn(),
    decide: vi.fn(),
    updateQueue: vi.fn(),
    deleteQueue: vi.fn(),
    resume: vi.fn(),
  };
  return renderToStaticMarkup(
    createElement(ConversationBody, {
      snapshot: sessionProjection(),
      providers: [],
      lastRun: undefined,
      commands,
    }),
  );
};

describe('imported history execution gate', () => {
  it('keeps historical text readable while hiding composer, pending controls and edit before binding', () => {
    owned.access = { importedThroughSeq: 10, bound: false };
    const html = render();
    expect(html).toContain('recorded historical text');
    expect(html).toContain('导入的只读会话');
    expect(html).toContain('配置并继续');
    expect(html).not.toContain('execution composer');
    expect(html).not.toContain('pending interaction controls');
    expect(owned.canEdit).toBe(false);
  });

  it('waits for current host access and allows current controls only after explicit binding', () => {
    expect(render()).not.toContain('execution composer');
    owned.access = { importedThroughSeq: 10, bound: true };
    expect(render()).toContain('execution composer');
    expect(owned.canEdit).toBe(false);
    const snapshot = sessionProjection();
    expect(snapshot.session.activeRunId).not.toBeNull();
  });
});
