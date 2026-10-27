import { fauxAssistantMessage, type TranscriptContext } from '@earendil-works/pi-ai';
import type { FrozenSkill } from '@my-pi-harness/protocol';
import { expect, it } from 'vitest';
import type { SkillsPort } from '../src/capabilities/ports.js';
import { fixture, idle, summary } from './support/work-fixture.js';

it('does not revive instructions discarded before the source context reset when selecting a later summary', async () => {
  const skill: FrozenSkill = {
    selection: { id: 'skill:reset', contentHash: 'd'.repeat(64) },
    authorization: { skillEpoch: 1, pluginId: null, pluginEpoch: 0, pluginGeneration: null },
    name: 'reset-source',
    description: 'Instructions before a context reset',
    scope: 'user',
    source: '/fixture/reset',
    content: 'BEFORE_RESET_INSTRUCTIONS_MUST_STAY_DISCARDED',
    resources: [],
    allowedTools: [],
  };
  const skills: SkillsPort = {
    list: () => Promise.resolve([]),
    freezeSelections: () => Promise.resolve([skill]),
    validateBindings: () => Promise.resolve(),
    assertBindingsCurrent: () => undefined,
    retainBindings: () => () => undefined,
    loadResource: () => Promise.resolve([]),
  };
  const f = await fixture(false, { skills });
  let restored: TranscriptContext | undefined;
  try {
    f.faux.setResponses([fauxAssistantMessage('Original instructions activated')]);
    await f.runtime.send(f.session.id, {
      text: 'Initial task',
      mode: 'send',
      requestId: 'before-reset',
      skills: [skill.selection],
    });
    await idle(f);
    const marker = f.runtime.getSnapshot(f.session.id).messages.at(-1)?.id;
    if (!marker) throw new Error('Missing reset marker');
    const beforeReset = f.work.snapshot(f.session.id).state;
    await f.work.reset(f.session.id, {
      expectedBranchId: beforeReset.branchId,
      revision: beforeReset.revision,
    });
    for (let index = 0; index < 3; index += 1) {
      f.faux.setResponses([
        (context) => {
          expect(JSON.stringify(context)).not.toContain(skill.content);
          return fauxAssistantMessage(`Post-reset answer ${String(index)}`);
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: `Post-reset task ${String(index)}`,
        mode: 'send',
        requestId: `after-reset-${String(index)}`,
      });
      await idle(f);
    }
    f.faux.setResponses([
      fauxAssistantMessage(summary('Continue only the tasks after the context reset.')),
    ]);
    const beforeCompaction = f.work.snapshot(f.session.id).state;
    const compacted = await f.work.compact(f.session.id, {
      expectedBranchId: beforeCompaction.branchId,
      revision: beforeCompaction.revision,
    });
    const compaction = compacted.state.compaction;
    if (!compaction) throw new Error('Missing summary checkpoint');
    expect(f.store.getCompactionContextStart(f.session.id, compaction.id)).toBe(marker);
    f.faux.setResponses([fauxAssistantMessage('Later answer')]);
    await f.runtime.send(f.session.id, {
      text: 'Later task',
      mode: 'send',
      requestId: 'later-tail',
    });
    await idle(f);
    const beforeSelection = f.work.snapshot(f.session.id).state;
    await f.work.selectCompaction(f.session.id, compaction.id, {
      expectedBranchId: beforeSelection.branchId,
      revision: beforeSelection.revision,
    });
    f.faux.setResponses([
      (context) => {
        restored = context;
        return fauxAssistantMessage('Continued the selected summary');
      },
    ]);
    await f.runtime.send(f.session.id, {
      text: 'Continue selected checkpoint',
      mode: 'send',
      requestId: 'selected-summary',
    });
    await idle(f);
    expect(JSON.stringify(restored)).not.toContain(skill.content);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});
