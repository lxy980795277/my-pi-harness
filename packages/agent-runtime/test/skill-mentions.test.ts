import { createHash } from 'node:crypto';
import { text as streamText } from 'node:stream/consumers';
import { fauxAssistantMessage, type TranscriptContext } from '@earendil-works/pi-ai';
import type { FrozenSkill, SkillView } from '@my-pi-harness/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { SkillsPort } from '../src/capability-ports.js';
import { explicitSkillNames } from '../src/skill-mentions.js';
import { RuntimeError } from '../src/errors.js';
import { call, fixture, gate, idle } from './support/work-fixture.js';

function skillCatalog() {
  let enabled = true;
  let epoch = 1;
  let generation = 'installed';
  let body = 'MENTION_SKILL_BODY: use the host-managed GitHub gateway.';
  const frozen = (): FrozenSkill => ({
    selection: {
      id: 'plugin:github-review',
      contentHash: createHash('sha256').update(body).digest('hex'),
    },
    authorization: {
      skillEpoch: epoch,
      pluginId: 'github',
      pluginEpoch: 1,
      pluginGeneration: generation,
    },
    name: 'github-review',
    description: 'Review GitHub repositories',
    scope: 'plugin',
    source: '/fixture/github-review',
    content: body,
    resources: [],
    allowedTools: [],
  });
  const metadata = (): SkillView => ({
    id: frozen().selection.id,
    contentHash: frozen().selection.contentHash,
    name: 'github-review',
    description: 'Review GitHub repositories',
    scope: 'plugin',
    pluginId: 'github',
    workspaceId: null,
    enabled,
    shadowed: false,
    managed: true,
    resourceCount: 0,
    source: '/fixture/github-review',
  });
  const freeze = vi.fn<SkillsPort['freezeSelections']>((_workspace, selections) => {
    if (!enabled) throw new RuntimeError('SKILL_DISABLED', 'Skill disabled');
    return Promise.resolve(
      selections.map((selection) => {
        if (
          selection.id !== frozen().selection.id ||
          selection.contentHash !== frozen().selection.contentHash
        )
          throw new RuntimeError('SKILL_CHANGED', 'Skill changed');
        return frozen();
      }),
    );
  });
  const current = (skills: readonly FrozenSkill[]): void => {
    if (!enabled && skills.length > 0) throw new RuntimeError('SKILL_DISABLED', 'Skill disabled');
    if (
      skills.some(
        (skill) =>
          skill.authorization.skillEpoch !== epoch ||
          skill.authorization.pluginGeneration !== generation,
      )
    )
      throw new RuntimeError('SKILL_CHANGED', 'Skill authorization changed');
  };
  const port: SkillsPort = {
    list: () =>
      Promise.resolve([
        metadata(),
        { ...metadata(), id: 'disabled', name: 'disabled-skill', enabled: false },
        { ...metadata(), id: 'shadowed', name: 'shadowed-skill', shadowed: true },
      ]),
    freezeSelections: freeze,
    validateBindings: (bindings) => {
      current(bindings);
      return Promise.resolve();
    },
    assertBindingsCurrent: current,
    retainBindings: () => () => undefined,
    loadResource: () => Promise.resolve([]),
  };
  return {
    port,
    freeze,
    frozen,
    disable: () => {
      enabled = false;
      epoch += 1;
    },
    reinstall: () => {
      generation = 'reinstalled';
      epoch += 1;
      body = 'REINSTALLED_SKILL_BODY';
    },
    change: () => {
      body = 'NEW_DISK_VERSION_MUST_NOT_REPLACE_QUEUED_BODY';
    },
  };
}

describe('explicit Skill invocations', () => {
  it.each(['mention', 'load_skill'] as const)(
    'retains the exact %s instruction snapshot in later Runs without fresh selection or tool grants',
    async (source) => {
      const s = skillCatalog();
      const f = await fixture(false, { skills: s.port });
      let continuation: TranscriptContext | undefined;
      try {
        f.faux.setResponses(
          source === 'mention'
            ? [fauxAssistantMessage('Skill ready')]
            : [call('load_skill', s.frozen().selection), fauxAssistantMessage('Skill ready')],
        );
        await f.runtime.send(f.session.id, {
          text:
            source === 'mention'
              ? '$github-review inspect repositories'
              : 'Load GitHub review instructions',
          mode: 'send',
          requestId: 'activate-history',
        });
        await idle(f);
        s.change();
        f.faux.setResponses([
          (context) => {
            continuation = context;
            return fauxAssistantMessage('Continued with the original instructions');
          },
        ]);
        await f.runtime.send(f.session.id, {
          text: 'Continue',
          mode: 'send',
          requestId: 'inherit-history',
        });
        await idle(f);
        expect(JSON.stringify(continuation)).toContain('MENTION_SKILL_BODY');
        expect(JSON.stringify(continuation)).not.toContain(
          'NEW_DISK_VERSION_MUST_NOT_REPLACE_QUEUED_BODY',
        );
        expect(s.freeze).toHaveBeenCalledOnce();
        expect(f.runtime.getSnapshot(f.session.id).runs.at(-1)?.skills).toEqual([]);
        expect(await streamText(f.store.exportSessionLog(f.session.id).content)).not.toContain(
          'run.skill_tools_granted',
        );
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );

  it.each(['disable', 'reinstall'] as const)(
    'omits unavailable inherited instructions after %s, reports the omission, and keeps ordinary conversation usable',
    async (action) => {
      const s = skillCatalog();
      const f = await fixture(false, { skills: s.port });
      let continuation: TranscriptContext | undefined;
      try {
        f.faux.setResponses([fauxAssistantMessage('Activated')]);
        await f.runtime.send(f.session.id, {
          text: '$github-review inspect',
          mode: 'send',
          requestId: 'activate-old',
        });
        await idle(f);
        if (action === 'disable') s.disable();
        else s.reinstall();
        f.faux.setResponses([
          (context) => {
            continuation = context;
            return fauxAssistantMessage('Plain conversation continues');
          },
        ]);
        await f.runtime.send(f.session.id, {
          text: 'Continue ordinary conversation',
          mode: 'send',
          requestId: 'after-revocation',
        });
        await idle(f);
        expect(JSON.stringify(continuation)).not.toContain('MENTION_SKILL_BODY');
        expect(JSON.stringify(continuation)).not.toContain('REINSTALLED_SKILL_BODY');
        expect(JSON.stringify(continuation)).toContain('unavailablePreviousSkills');
        expect(f.runtime.getSnapshot(f.session.id).runs.at(-1)?.status).toBe('completed');
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );

  it('does not carry a Skill activated after a fork point into the edited branch', async () => {
    const s = skillCatalog();
    const f = await fixture(false, { skills: s.port });
    let forked: TranscriptContext | undefined;
    try {
      f.faux.setResponses([fauxAssistantMessage('First answer')]);
      await f.runtime.send(f.session.id, {
        text: 'First plain task',
        mode: 'send',
        requestId: 'before-skill',
      });
      await idle(f);
      const first = f.runtime
        .getSnapshot(f.session.id)
        .messages.find(({ role }) => role === 'user');
      if (!first) throw new Error('Missing first input');
      f.faux.setResponses([fauxAssistantMessage('Activated later')]);
      await f.runtime.send(f.session.id, {
        text: '$github-review use later instructions',
        mode: 'send',
        requestId: 'after-fork-point',
      });
      await idle(f);
      f.faux.setResponses([
        (context) => {
          forked = context;
          return fauxAssistantMessage('Independent branch');
        },
      ]);
      await f.runtime.editAndResend(f.session.id, {
        messageId: first.id,
        text: 'Alternative first task',
        requestId: 'fork-before-skill',
      });
      await idle(f);
      expect(JSON.stringify(forked)).not.toContain('MENTION_SKILL_BODY');
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('can resume an ordinary queued input after inherited Skill authority is revoked', async () => {
    const s = skillCatalog();
    const f = await fixture(false, { skills: s.port });
    const entered = gate();
    const finish = gate();
    let resumed: TranscriptContext | undefined;
    try {
      f.faux.setResponses([fauxAssistantMessage('Activated')]);
      await f.runtime.send(f.session.id, {
        text: '$github-review first task',
        mode: 'send',
        requestId: 'initial-skill',
      });
      await idle(f);
      f.faux.setResponses([
        async () => {
          entered.release();
          await finish.promise;
          return fauxAssistantMessage('Interrupted');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Continue',
        mode: 'send',
        requestId: 'inherited-run',
      });
      await entered.promise;
      await f.runtime.send(f.session.id, {
        text: 'Plain queued continuation',
        mode: 'follow-up',
        requestId: 'inherited-queue',
      });
      const cancelling = f.runtime.cancel(f.session.id);
      finish.release();
      await cancelling;
      expect(await streamText(f.store.exportSessionLog(f.session.id).content)).toContain(
        'inheritedSkillBindings',
      );
      s.disable();
      f.faux.setResponses([
        (context) => {
          resumed = context;
          return fauxAssistantMessage('Continued without the unavailable Skill');
        },
      ]);
      await f.runtime.resumeQueue(f.session.id);
      await idle(f);
      expect(JSON.stringify(resumed)).not.toContain('MENTION_SKILL_BODY');
      expect(JSON.stringify(resumed)).toContain('unavailablePreviousSkills');
      expect(f.runtime.getSnapshot(f.session.id).queue).toEqual([]);
      expect(f.errors).toEqual([]);
    } finally {
      finish.release();
      await f.close();
    }
  });

  it('recognizes standalone lowercase names and ignores shell variables, embedded names and malformed suffixes', () => {
    expect([...explicitSkillNames('$github-review ($pdf),\n$github-review')]).toEqual([
      'github-review',
      'pdf',
    ]);
    expect([
      ...explicitSkillNames(
        'abc$github-review $HOME $github_review $github-review- $github--review ` $not-installed',
      ),
    ]).toEqual(['not-installed']);
  });

  it.each([true, false])(
    'freezes an enabled mention before the first model request without adding picker choices or tool grants, context=%s',
    async (withContext) => {
      const s = skillCatalog();
      const f = await fixture(false, { skills: s.port, context: withContext });
      let captured: TranscriptContext | undefined;
      try {
        f.faux.setResponses([
          (context) => {
            captured = context;
            return fauxAssistantMessage('Applied the requested Skill');
          },
        ]);
        await f.runtime.send(f.session.id, {
          text: '$github-review inspect repositories',
          mode: 'send',
          requestId: 'explicit-mention',
        });
        await idle(f);
        expect(JSON.stringify(captured)).toContain('MENTION_SKILL_BODY');
        expect(s.freeze).toHaveBeenCalledOnce();
        const snapshot = f.runtime.getSnapshot(f.session.id);
        expect(snapshot.runs[0]?.skills).toEqual([]);
        expect(snapshot.messages.find(({ role }) => role === 'user')?.skills).toEqual([]);
        const log = await streamText(f.store.exportSessionLog(f.session.id).content);
        expect(log).toContain('MENTION_SKILL_BODY');
        expect(log).not.toContain('run.skill_tools_granted');
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );

  it('does not activate disabled, shadowed or unknown explicit names', async () => {
    const s = skillCatalog();
    const f = await fixture(false, { skills: s.port });
    let captured: TranscriptContext | undefined;
    try {
      f.faux.setResponses([
        (context) => {
          captured = context;
          return fauxAssistantMessage('No matching enabled Skill');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: '$disabled-skill $shadowed-skill $unknown',
        mode: 'send',
        requestId: 'ignored-mentions',
      });
      await idle(f);
      expect(s.freeze).not.toHaveBeenCalled();
      expect(JSON.stringify(captured)).not.toContain('MENTION_SKILL_BODY');
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('adds a queued explicit invocation to the same Run at the next request barrier', async () => {
    const s = skillCatalog();
    const f = await fixture(false, { skills: s.port });
    const entered = gate();
    const finish = gate();
    const requests: TranscriptContext[] = [];
    try {
      f.faux.setResponses([
        async (context) => {
          requests.push(context);
          entered.release();
          await finish.promise;
          return fauxAssistantMessage('First task complete');
        },
        (context) => {
          requests.push(context);
          return fauxAssistantMessage('Follow-up applied the requested Skill');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Start a plain task',
        mode: 'send',
        requestId: 'plain',
      });
      await entered.promise;
      await f.runtime.send(f.session.id, {
        text: '$github-review inspect the next task',
        mode: 'follow-up',
        requestId: 'mentioned-follow-up',
      });
      const before = await streamText(f.store.exportSessionLog(f.session.id).content);
      expect(before).toContain('mentionedSkillBindings');
      expect(before).not.toContain('run.tools_loaded');
      finish.release();
      await idle(f);
      expect(requests).toHaveLength(2);
      expect(JSON.stringify(requests[0])).not.toContain('MENTION_SKILL_BODY');
      expect(JSON.stringify(requests[1])).toContain('MENTION_SKILL_BODY');
      const snapshot = f.runtime.getSnapshot(f.session.id);
      expect(snapshot.runs).toHaveLength(1);
      expect(snapshot.queue).toEqual([]);
      const log = await streamText(f.store.exportSessionLog(f.session.id).content);
      expect(log).toContain('run.tools_loaded');
      expect(log).not.toContain('run.skill_tools_granted');
      expect(f.errors).toEqual([]);
    } finally {
      finish.release();
      await f.close();
    }
  });

  it.each(['resume', 'revoke', 'edit'] as const)(
    'keeps explicit invocation snapshots through cancellation and %s',
    async (action) => {
      const s = skillCatalog();
      const f = await fixture(false, { skills: s.port });
      const entered = gate();
      const finish = gate();
      let resumed: TranscriptContext | undefined;
      try {
        f.faux.setResponses([
          async () => {
            entered.release();
            await finish.promise;
            return fauxAssistantMessage('Interrupted');
          },
        ]);
        await f.runtime.send(f.session.id, { text: 'Start', mode: 'send', requestId: 'start' });
        await entered.promise;
        await f.runtime.send(f.session.id, {
          text: '$github-review inspect later',
          mode: 'follow-up',
          requestId: 'queue-mention',
        });
        const cancelling = f.runtime.cancel(f.session.id);
        finish.release();
        await cancelling;
        expect(f.runtime.getSnapshot(f.session.id).queue).toHaveLength(1);
        if (action === 'revoke') {
          s.disable();
          await expect(f.runtime.resumeQueue(f.session.id)).rejects.toMatchObject({
            code: 'SKILL_DISABLED',
          });
          expect(f.runtime.getSnapshot(f.session.id).queue).toHaveLength(1);
          expect(s.freeze).toHaveBeenCalledOnce();
          return;
        }
        if (action === 'edit') {
          const queued = f.runtime.getSnapshot(f.session.id).queue[0];
          if (!queued) throw new Error('Missing queued input');
          await f.runtime.updateQueue(f.session.id, queued.id, {
            revision: queued.revision,
            text: 'Continue without an explicit Skill invocation',
          });
        } else s.change();
        f.faux.setResponses([
          (context) => {
            resumed = context;
            return fauxAssistantMessage('Resumed');
          },
        ]);
        await f.runtime.resumeQueue(f.session.id);
        await idle(f);
        if (action === 'resume') {
          expect(JSON.stringify(resumed)).toContain('MENTION_SKILL_BODY');
          expect(JSON.stringify(resumed)).not.toContain(
            'NEW_DISK_VERSION_MUST_NOT_REPLACE_QUEUED_BODY',
          );
          expect(s.freeze).toHaveBeenCalledOnce();
        } else expect(JSON.stringify(resumed)).not.toContain('MENTION_SKILL_BODY');
        expect(f.runtime.getSnapshot(f.session.id).queue).toEqual([]);
        expect(f.errors).toEqual([]);
      } finally {
        finish.release();
        await f.close();
      }
    },
  );
});
