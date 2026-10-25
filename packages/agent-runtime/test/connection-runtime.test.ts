import { text as streamText } from 'node:stream/consumers';
import { fauxAssistantMessage, type TranscriptContext } from '@earendil-works/pi-ai';
import type { ConnectionOperationView, FrozenSkill } from '@my-pi-harness/protocol';
import type { SessionBatch } from '@my-pi-harness/storage';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionGatewayPort } from '../src/connection-ports.js';
import type { SkillsPort } from '../src/capability-ports.js';
import { call, fixture, idle, observe } from './support/work-fixture.js';

const skill: FrozenSkill = {
  selection: { id: 'plugin:github', contentHash: 'a'.repeat(64) },
  authorization: {
    skillEpoch: 1,
    pluginId: 'github',
    pluginEpoch: 1,
    pluginGeneration: 'installed',
  },
  name: 'GitHub',
  description: 'Service Skill',
  scope: 'plugin',
  source: '/registered/plugin/github',
  content: 'Use explicit service grants for this task.',
  resources: [],
  allowedTools: [],
};
function gateway() {
  const operations: ConnectionOperationView[] = [
    {
      id: 'service_github_user',
      connectionId: 'connection',
      accountId: 'account',
      serviceId: 'github',
      app: 'GitHub',
      name: 'Read account',
      description: 'Read the current account',
      readOnly: true,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  ];
  const freeze = vi.fn<ConnectionGatewayPort['freezeGrant']>((request) =>
    Promise.resolve({
      id: 'grant',
      runId: request.runId,
      skillId: skill.selection.id,
      skillHash: skill.selection.contentHash,
      pluginId: 'github',
      pluginEpoch: 1,
      connectionId: 'connection',
      serviceId: 'github',
      accountId: 'account',
      ownerId: 'owner',
      identityEpoch: 1,
      revision: 1,
      accessEpoch: 1,
      operations: [...request.operations],
      expiresAt: request.expiresAt,
    }),
  );
  const execute = vi.fn<ConnectionGatewayPort['call']>(async (input) => {
    await input.beforeDispatch();
    return {
      kind: 'known',
      isError: false,
      content: [{ type: 'text', text: 'ACCOUNT_RESULT' }],
      summary: 'Account read',
    };
  });
  const revoke = vi.fn<ConnectionGatewayPort['revokeRun']>();
  const port: ConnectionGatewayPort = {
    catalog: () => Promise.resolve(operations),
    freezeGrant: freeze,
    call: execute,
    revokeRun: revoke,
  };
  const skills: SkillsPort = {
    list: () => Promise.resolve([]),
    freezeSelections: () => Promise.resolve([skill]),
    validateBindings: () => Promise.resolve(),
    assertBindingsCurrent: () => undefined,
    retainBindings: () => () => undefined,
    loadResource: () => Promise.resolve([]),
  };
  return { port, skills, freeze, execute, revoke };
}
const grantArgs = {
  skillId: skill.selection.id,
  connectionId: 'connection',
  operations: ['service_github_user'],
};
function grantedName(context: TranscriptContext): string {
  const name = context.messages
    .flatMap((message) =>
      message.role === 'system' ? (message.toolsAdded ?? []).map((tool) => tool.name) : [],
    )
    .find((name) => name.startsWith('service_') && name !== 'service_search');
  if (!name) throw new Error('Missing offered service operation');
  return name;
}

describe('service grants in the actual Pi and durable tool pipeline', () => {
  it('keeps a denied grant out of the model and never requests a credentialed call', async () => {
    const g = gateway();
    const f = await fixture(false, { skills: g.skills, connectionGateway: g.port });
    try {
      await f.runtime.updateSession(f.session.id, { approvalMode: 'full-access' });
      f.faux.setResponses([
        call('request_service_access', grantArgs),
        fauxAssistantMessage('Denied'),
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Read account',
        mode: 'send',
        requestId: 'deny',
        skills: [skill.selection],
      });
      await observe(
        f.runtime,
        f.session.id,
        (snapshot) => snapshot.tools[0]?.status === 'awaiting_approval',
      );
      const pending = f.runtime.getSnapshot(f.session.id).tools[0];
      if (!pending || !f.tools) throw new Error('Missing approval');
      f.tools.decide(f.session.id, pending.id, { decision: 'deny' });
      await idle(f);
      expect(g.freeze).not.toHaveBeenCalled();
      expect(g.execute).not.toHaveBeenCalled();
      expect(f.runtime.getSnapshot(f.session.id).tools[0]?.status).toBe('denied');
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it.each(['known', 'unknown'] as const)(
    'offers a finite account-bound tool only after approval and records %s result',
    async (kind) => {
      const g = gateway();
      const f = await fixture(false, { skills: g.skills, connectionGateway: g.port });
      let requests = 0;
      try {
        await f.runtime.updateSession(f.session.id, { approvalMode: 'full-access' });
        if (kind === 'unknown')
          g.execute.mockImplementation(async (input) => {
            await input.beforeDispatch();
            return { kind: 'unknown', message: 'May have taken effect; verify it.' };
          });
        f.faux.setResponses([
          () => {
            requests += 1;
            return call('request_service_access', grantArgs);
          },
          (context) => {
            requests += 1;
            return call(grantedName(context), {});
          },
          () => {
            requests += 1;
            return fauxAssistantMessage('Account result observed');
          },
        ]);
        await f.runtime.send(f.session.id, {
          text: 'Read account',
          mode: 'send',
          requestId: kind,
          skills: [skill.selection],
        });
        await observe(
          f.runtime,
          f.session.id,
          (snapshot) => snapshot.tools[0]?.status === 'awaiting_approval',
        );
        const pending = f.runtime.getSnapshot(f.session.id).tools[0];
        if (!pending || !f.tools) throw new Error('Missing approval');
        f.tools.decide(f.session.id, pending.id, { decision: 'allow' });
        await idle(f);
        expect(g.freeze).toHaveBeenCalledTimes(1);
        expect(g.execute).toHaveBeenCalledTimes(1);
        const snapshot = f.runtime.getSnapshot(f.session.id);
        const child = snapshot.tools[1];
        if (!child) throw new Error('Missing service tool result');
        expect(child.binding).toMatchObject({
          kind: 'accepted',
          source: {
            kind: 'connection',
            connectionId: 'connection',
            grantId: 'grant',
            operation: 'service_github_user',
          },
        });
        expect(child.dispatch.state).toBe('may_have_started');
        expect(child.status).toBe(kind === 'known' ? 'completed' : 'unknown');
        expect(g.execute.mock.calls[0]?.[0]).toMatchObject({
          parentToolCallId: child.id,
          runId: snapshot.runs[0]?.id,
        });
        expect(requests).toBe(kind === 'known' ? 3 : 2);
        expect(g.revoke).toHaveBeenCalledWith(snapshot.runs[0]?.id);
        const records = (await streamText(f.store.exportSessionLog(f.session.id).content))
          .trim()
          .split('\n')
          .flatMap((line) => (JSON.parse(line) as SessionBatch).records);
        expect(
          records.find(({ event }) => event.type === 'run.service_access_granted')?.privateData,
        ).toContain('account');
        expect(
          records.find(({ event }) => event.type === 'run.tools_loaded')?.event.data['revision'],
        ).toBe(2);
        expect(() => f.store.recoverInterrupted()).not.toThrow();
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );
});
