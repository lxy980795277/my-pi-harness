import { fauxAssistantMessage, type TranscriptContext } from '@earendil-works/pi-ai';
import type { SessionExecutionAccess } from '@my-pi-harness/protocol';
import type { FrozenSkill } from '@my-pi-harness/protocol/internal';
import { describe, expect, it, vi } from 'vitest';
import type { SkillsPort } from '../src/capabilities/ports';
import { fixture, gate, idle, sendTurn } from './support/work-fixture';
import { skillCandidate } from './support/skill-candidate';

describe('imported execution admission', () => {
  it('serializes binding before newly queued execution and never exposes a partially bound configuration', async () => {
    const f = await fixture();
    const entered = gate();
    const finish = gate();
    const access: SessionExecutionAccess = { importedThroughSeq: 1, bound: false };
    try {
      const operation = vi.fn();
      await expect(
        f.runtime.importedBindingCommand(f.session.id, operation),
      ).rejects.toHaveProperty('code', 'SESSION_NOT_IMPORTED');
      expect(operation).not.toHaveBeenCalled();
      vi.spyOn(f.store, 'getSessionExecutionAccess').mockImplementation(() => access);
      f.faux.setResponses([fauxAssistantMessage('Fresh local response')]);
      const binding = f.runtime.importedBindingCommand(f.session.id, async () => {
        entered.release();
        await finish.promise;
        f.store.append(f.session.id, [
          {
            type: 'session.configured',
            runId: null,
            at: Date.now(),
            data: { approvalMode: 'read-only' },
          },
        ]);
        access.bound = true;
      });
      await entered.promise;
      const sent = f.runtime.send(f.session.id, {
        text: 'New local input',
        mode: 'send',
        requestId: 'after-binding',
      });
      expect(f.faux.state.callCount).toBe(0);
      finish.release();
      await binding;
      await sent;
      await idle(f);
      expect(f.runtime.getSnapshot(f.session.id).session.approvalMode).toBe('read-only');
      expect(f.faux.state.callCount).toBe(1);
      expect(access.importedThroughSeq).toBe(1);
      expect(f.errors).toEqual([]);
    } finally {
      finish.release();
      vi.restoreAllMocks();
      await f.close();
    }
  });

  it('refuses to rebind a session with an accepted active Run', async () => {
    const f = await fixture();
    const entered = gate();
    const finish = gate();
    try {
      vi.spyOn(f.store, 'getSessionExecutionAccess').mockReturnValue({
        importedThroughSeq: 1,
        bound: true,
      });
      f.faux.setResponses([
        async () => {
          entered.release();
          await finish.promise;
          return fauxAssistantMessage('Finished');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Running work',
        mode: 'send',
        requestId: 'active',
      });
      await entered.promise;
      const operation = vi.fn();
      await expect(
        f.runtime.importedBindingCommand(f.session.id, operation),
      ).rejects.toHaveProperty('code', 'SESSION_BUSY');
      expect(operation).not.toHaveBeenCalled();
      finish.release();
      await idle(f);
    } finally {
      finish.release();
      vi.restoreAllMocks();
      await f.close();
    }
  });

  it('refuses binding when another request is already queued for the session gate', async () => {
    const f = await fixture();
    try {
      vi.spyOn(f.store, 'getSessionExecutionAccess').mockReturnValue({
        importedThroughSeq: 1,
        bound: false,
      });
      const operation = vi.fn();
      const binding = f.runtime.importedBindingCommand(f.session.id, operation);
      const sent = f.runtime.send(f.session.id, {
        text: 'Concurrent unbound request',
        mode: 'send',
        requestId: 'concurrent',
      });
      await Promise.all([
        expect(binding).rejects.toHaveProperty('code', 'SESSION_BUSY'),
        expect(sent).rejects.toHaveProperty('code', 'SESSION_IMPORT_UNBOUND'),
      ]);
      expect(operation).not.toHaveBeenCalled();
      expect(f.faux.state.callCount).toBe(0);
    } finally {
      vi.restoreAllMocks();
      await f.close();
    }
  });

  it('allows reading and branch browsing while denying unbound sends, queue replay, configuration and work execution before model resolution', async () => {
    const f = await fixture();
    try {
      await sendTurn(f, 'Historical question', 'Historical answer');
      const snapshot = f.runtime.getSnapshot(f.session.id);
      const input = snapshot.messages.find(({ role }) => role === 'user');
      if (!input) throw new Error('Missing historical input');
      vi.spyOn(f.store, 'getSessionExecutionAccess').mockReturnValue({
        importedThroughSeq: snapshot.snapshotSeq,
        bound: false,
      });
      const calls = f.faux.state.callCount;
      const events = snapshot.snapshotSeq;
      expect(f.runtime.getSnapshot(f.session.id).messages).toEqual(snapshot.messages);
      expect(f.work.snapshot(f.session.id).state).toBeDefined();
      await expect(
        f.runtime.selectBranch(f.session.id, snapshot.session.activeBranchId),
      ).resolves.toHaveProperty('session.id', f.session.id);
      expect(() => f.runtime.assertSessionExecutionAllowed(f.session.id)).toThrow(
        expect.objectContaining({ code: 'SESSION_IMPORT_UNBOUND' }),
      );
      const state = f.work.snapshot(f.session.id).state;
      const reset = { expectedBranchId: state.branchId, revision: state.revision };
      const attempts = [
        () =>
          f.runtime.send(f.session.id, {
            text: 'New work',
            mode: 'send',
            requestId: 'blocked-send',
          }),
        () =>
          f.runtime.editAndResend(f.session.id, {
            messageId: input.id,
            text: 'Edited',
            requestId: 'blocked-edit',
          }),
        () => f.runtime.resumeQueue(f.session.id),
        () =>
          f.runtime.updateQueue(f.session.id, 'historical-queue', {
            text: 'Edited queue',
            revision: 1,
          }),
        () => f.runtime.updateSession(f.session.id, { approvalMode: 'full-access' }),
        () => f.work.compact(f.session.id, reset),
        () => f.work.reset(f.session.id, reset),
        () => f.work.restore(f.session.id, 'historical-checkpoint', reset),
        () => f.work.answer(f.session.id, 'historical-question', []),
        () =>
          f.work.reviewPlan(f.session.id, 'historical-plan', {
            ...reset,
            decision: 'approve',
            feedback: '',
          }),
      ];
      for (const attempt of attempts)
        await expect(attempt()).rejects.toHaveProperty('code', 'SESSION_IMPORT_UNBOUND');
      expect(f.faux.state.callCount).toBe(calls);
      expect(f.store.readEvents(f.session.id, events, 100).map(({ type }) => type)).toEqual([
        'branch.selected',
      ]);
      expect(f.errors).toEqual([]);
    } finally {
      vi.restoreAllMocks();
      await f.close();
    }
  });

  it('admits a newly bound edit with current configuration without silently selecting historical tools or Skills', async () => {
    const skill: FrozenSkill = {
      selection: { id: 'skill:imported', contentHash: 'f'.repeat(64) },
      authorization: { skillEpoch: 1, pluginId: null, pluginEpoch: 0, pluginGeneration: null },
      name: 'imported-history-skill',
      description: 'An original Skill',
      scope: 'user',
      source: '/historical/skill',
      content: 'HISTORICAL_INSTRUCTIONS_ARE_NOT_FRESH_AUTHORITY',
      resources: [],
      allowedTools: [],
    };
    const freeze = vi.fn<SkillsPort['freezeSelections']>((_workspace, selected) =>
      Promise.resolve(selected.length ? [skill] : []),
    );
    const skills: SkillsPort = {
      freezeCandidates: () => Promise.resolve([skillCandidate(skill)]),
      loadCandidate: () => Promise.resolve(skill),
      list: () => Promise.resolve([]),
      freezeSelections: freeze,
      validateBindings: () => Promise.resolve(),
      assertBindingsCurrent: () => undefined,
      retainBindings: () => () => undefined,
      loadResource: () => Promise.resolve([]),
    };
    const f = await fixture(false, { skills });
    try {
      f.faux.setResponses([fauxAssistantMessage('Original result')]);
      await f.runtime.send(f.session.id, {
        text: 'Original input',
        mode: 'send',
        requestId: 'original',
        skills: [skill.selection],
      });
      await idle(f);
      const old = f.runtime.getSnapshot(f.session.id);
      const input = old.messages.find(({ role }) => role === 'user');
      if (!input) throw new Error('Missing original input');
      expect(f.store.getSkillContext(f.session.id, old.session.activeBranchId)).toEqual([skill]);
      f.store.append(f.session.id, [
        {
          type: 'session.imported',
          runId: null,
          at: Date.now(),
          data: {
            operationId: 'import-fixture',
            archiveSha256: 'a'.repeat(64),
            importedThroughSeq: old.snapshotSeq,
          },
          privateData: { importOwner: { userId: null } },
        },
      ]);
      const historicalBindings = vi.spyOn(f.store, 'getSkillContext');
      expect(f.store.getSkillContext(f.session.id, old.session.activeBranchId)).toEqual([]);
      await expect(
        f.runtime.send(f.session.id, {
          text: 'Before binding',
          mode: 'send',
          requestId: 'before-binding',
        }),
      ).rejects.toHaveProperty('code', 'SESSION_IMPORT_UNBOUND');
      f.store.putProvider({
        id: f.session.providerId,
        name: 'Current fixture model',
        kind: 'custom',
        builtinId: null,
        api: 'openai-completions',
        baseUrl: 'https://fixture.invalid/v1',
        models: [],
        enabled: true,
        requiresApiKey: false,
        revision: 1,
        hasCredential: false,
        credentialType: null,
        legacy: false,
        configured: true,
        authSource: 'none',
        credentialPreview: null,
        credentialRef: 'no-fixture-secret',
      });
      await f.runtime.importedBindingCommand(f.session.id, () =>
        f.store.bindSessionArchive(f.session.id, {
          providerId: f.session.providerId,
          modelId: f.session.modelId,
          thinkingLevel: 'off',
          workspaceId: null,
        }),
      );
      expect(f.store.getSessionExecutionAccess(f.session.id)).toEqual({
        importedThroughSeq: old.snapshotSeq,
        bound: true,
      });
      expect(f.runtime.getSnapshot(f.session.id).session.approvalMode).toBe('ask');
      await f.runtime.updateSession(f.session.id, {
        approvalMode: 'read-only',
        thinkingLevel: 'off',
      });
      freeze.mockClear();
      let observed: TranscriptContext | undefined;
      f.faux.setResponses([
        (context) => {
          observed = context;
          return fauxAssistantMessage('Bound result');
        },
      ]);
      await f.runtime.editAndResend(f.session.id, {
        messageId: input.id,
        text: 'New user-selected input',
        requestId: 'bound-edit',
      });
      await idle(f);
      const latest = f.runtime.getSnapshot(f.session.id);
      expect(freeze).not.toHaveBeenCalled();
      expect(historicalBindings).toHaveBeenCalled();
      expect(JSON.stringify(observed)).not.toContain(skill.content);
      expect(latest.runs.at(-1)).toMatchObject({
        providerId: f.session.providerId,
        modelId: f.session.modelId,
        skills: [],
      });
      expect(latest.session.approvalMode).toBe('read-only');
      expect(
        latest.messages.find(({ text }) => text === 'New user-selected input')?.skills,
      ).toEqual([]);
      expect(f.store.getSessionExecutionAccess(f.session.id).importedThroughSeq).toBe(
        old.snapshotSeq,
      );
      await expect(f.runtime.resumeQueue(f.session.id)).rejects.toHaveProperty(
        'code',
        'QUEUE_EMPTY',
      );
      f.faux.setResponses([fauxAssistantMessage('Explicitly selected current capability')]);
      await f.runtime.send(f.session.id, {
        text: 'Use my explicit current selection',
        mode: 'send',
        requestId: 'fresh-selection',
        skills: [skill.selection],
      });
      await idle(f);
      expect(freeze.mock.calls.map(([, selected]) => selected)).toEqual([[skill.selection]]);
      expect(f.errors).toEqual([]);
    } finally {
      vi.restoreAllMocks();
      await f.close();
    }
  });
});
