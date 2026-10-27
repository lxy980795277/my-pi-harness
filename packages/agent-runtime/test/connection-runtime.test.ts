import { text as streamText } from 'node:stream/consumers';
import { createServer } from 'node:http';
import { fauxAssistantMessage, type TranscriptContext } from '@earendil-works/pi-ai';
import type { FrozenSkill } from '@my-pi-harness/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { SkillsPort } from '../src/capabilities/ports.js';
import { call, fixture, idle } from './support/work-fixture.js';

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
  content: 'Read service API paths using web_fetch GET and this active Skill gatewayUrl.',
  gatewayUrl: 'http://127.0.0.1:4311/api/skill-gateway/github',
  resources: [],
  allowedTools: ['web_fetch'],
};
function skills(): SkillsPort {
  return {
    list: () => Promise.resolve([]),
    freezeSelections: () => Promise.resolve([skill]),
    validateBindings: () => Promise.resolve(),
    assertBindingsCurrent: () => undefined,
    retainBindings: () => () => undefined,
    loadResource: () => Promise.resolve([]),
  };
}

describe('plugin gateway instructions through the actual model and durable input', () => {
  it.each([true, false])(
    'offers the recorded read-only gateway without account grants or private capabilities, workspace=%s',
    async (withWorkspace) => {
      const f = await fixture(withWorkspace, {
        skills: skills(),
        skillGateway: { origin: 'http://127.0.0.1:4311', token: 'private-host-capability' },
      });
      const appends = vi.spyOn(f.store, 'append');
      let captured: TranscriptContext | undefined;
      try {
        f.faux.setResponses([
          (context) => {
            captured = context;
            return fauxAssistantMessage('Ready to read the authorized service.');
          },
        ]);
        await f.runtime.send(f.session.id, {
          text: 'Read the current GitHub account',
          mode: 'send',
          requestId: 'plugin-gateway-model-input',
          skills: [skill.selection],
        });
        await idle(f);
        if (captured === undefined) throw new Error('Missing actual model request');
        const toolNames = captured.messages.flatMap((message) =>
          message.role === 'system' ? (message.toolsAdded ?? []).map((tool) => tool.name) : [],
        );
        expect(toolNames).toContain('web_fetch');
        expect(toolNames).not.toContain('service_search');
        expect(toolNames).not.toContain('request_service_access');
        expect(toolNames).not.toContain('revoke_service_access');
        const modelInput = JSON.stringify(captured);
        expect(modelInput).toContain(skill.gatewayUrl);
        expect(modelInput).not.toContain('private-host-capability');
        const log = await streamText(f.store.exportSessionLog(f.session.id).content);
        const records = appends.mock.calls.flatMap(([, events]) => events);
        expect(
          JSON.stringify(records.find(({ type }) => type === 'run.accepted')?.privateData),
        ).toContain(skill.gatewayUrl);
        expect(
          JSON.stringify(records.find(({ type }) => type === 'context.prepared')?.privateData),
        ).toContain(skill.gatewayUrl);
        expect(log).not.toContain('private-host-capability');
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );

  it('executes the exact gateway without a workspace and keeps the private host capability out of the model and log', async () => {
    const headers: (string | string[] | undefined)[] = [];
    const server = createServer((request, response) => {
      headers.push(request.headers['x-pi-harness-skill-gateway']);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ login: 'synthetic-oauth-account', repositoryCount: 3 }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Missing fixture port');
    const origin = `http://127.0.0.1:${address.port}`;
    const token = 'private-synthetic-gateway-capability';
    const localSkill = { ...skill, gatewayUrl: `${origin}/api/skill-gateway/github` };
    const port = skills();
    port.freezeSelections = () => Promise.resolve([localSkill]);
    const f = await fixture(false, { skills: port, skillGateway: { origin, token } });
    const requests: TranscriptContext[] = [];
    try {
      await f.runtime.updateSession(f.session.id, { approvalMode: 'full-access' });
      f.faux.setResponses([
        (context) => {
          requests.push(context);
          return call('web_fetch', { url: `${localSkill.gatewayUrl}/user` });
        },
        (context) => {
          requests.push(context);
          return fauxAssistantMessage('Read the authorized account');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Read GitHub',
        mode: 'send',
        requestId: 'workspace-free-gateway',
        skills: [skill.selection],
      });
      await idle(f);
      expect(headers).toEqual([token]);
      const model = JSON.stringify(requests);
      expect(model).toContain('synthetic-oauth-account');
      expect(model).not.toContain(token);
      const offered =
        requests[0]?.messages.flatMap((message) =>
          message.role === 'system' ? (message.toolsAdded ?? []).map(({ name }) => name) : [],
        ) ?? [];
      expect(offered).toContain('web_fetch');
      expect(offered).not.toContain('read_file');
      expect(offered).not.toContain('shell');
      expect(f.runtime.getSnapshot(f.session.id).tools[0]).toMatchObject({
        name: 'web_fetch',
        status: 'completed',
        binding: { source: { kind: 'session' } },
      });
      expect(await streamText(f.store.exportSessionLog(f.session.id).content)).not.toContain(token);
      expect(f.errors).toEqual([]);

      await f.runtime.updateSession(f.session.id, { approvalMode: 'read-only' });
      f.faux.setResponses([
        call('web_fetch', { url: `${localSkill.gatewayUrl}/user`, method: 'POST', body: '{}' }),
        fauxAssistantMessage('Network write was denied'),
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Try a write',
        mode: 'send',
        requestId: 'workspace-free-write',
        skills: [skill.selection],
      });
      await idle(f);
      expect(headers).toHaveLength(1);
      expect(f.runtime.getSnapshot(f.session.id).tools.at(-1)).toMatchObject({
        name: 'web_fetch',
        status: 'denied',
      });
    } finally {
      await f.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
