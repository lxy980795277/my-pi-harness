import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { text as streamText } from 'node:stream/consumers';
import { fauxAssistantMessage, type TranscriptContext } from '@earendil-works/pi-ai';
import { describe, expect, it, vi } from 'vitest';
import { call, fixture, idle, observe, questionArgs } from './support/work-fixture.js';

function resultText(context: TranscriptContext, name: string): string {
  const message = [...context.messages]
    .reverse()
    .find((entry) => entry.role === 'toolResult' && entry.toolName === name);
  if (!message || message.role !== 'toolResult') throw new Error(`Missing ${name} result`);
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function pageText(page: string): string {
  return page.slice(page.indexOf('\n\n') + 2);
}

describe('retained tool text reading', () => {
  it('recovers six omitted middle facts through real HTTP, history search and a bounded Pi tool read without refetching', async () => {
    const facts = Array.from(
      { length: 6 },
      (_, index) => `Middle fact ${index + 1}: observed-value-${index + 1}`,
    );
    const source = `<html>${'navigation '.repeat(1800)}\nMIDDLE-EVIDENCE\n${facts.join('\n' + 'quoted "text"\t\n'.repeat(30))}\n${'footer '.repeat(1800)}</html>`;
    const headers: (string | string[] | undefined)[] = [];
    const server = createServer((request, response) => {
      headers.push(request.headers['x-pi-harness-skill-gateway']);
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(source);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Missing fixture listener');
    const origin = `http://127.0.0.1:${address.port}`;
    const token = 'test-only-private-gateway-capability';
    let f: Awaited<ReturnType<typeof fixture>> | undefined;
    try {
      f = await fixture(false, { skillGateway: { origin, token } });
      await f.runtime.updateSession(f.session.id, { approvalMode: 'full-access' });
      const contexts: TranscriptContext[] = [];
      f.faux.setResponses([
        (context) => {
          contexts.push(context);
          return call('web_fetch', { url: `${origin}/api/skill-gateway/test/document` });
        },
        (context) => {
          contexts.push(context);
          const projected = resultText(context, 'web_fetch');
          expect(projected).not.toContain(facts[0]);
          expect(projected).toContain('search_session_history');
          expect(projected).toContain('read_tool_result');
          return call('search_session_history', { query: 'MIDDLE-EVIDENCE', limit: 2 });
        },
        (context) => {
          contexts.push(context);
          const search = JSON.parse(resultText(context, 'search_session_history')) as {
            matches: { id: string; kind: string; offset: number; totalCharacters: number }[];
          };
          const match = search.matches.find(({ kind }) => kind === 'tool:web_fetch');
          if (!match) throw new Error('Missing retained web match');
          expect(match.offset).toBeGreaterThan(4096);
          return call('read_tool_result', { toolCallId: match.id, offset: match.offset });
        },
        (context) => {
          contexts.push(context);
          const page = resultText(context, 'read_tool_result');
          for (const fact of facts) expect(page).toContain(fact);
          expect(page).toContain('Next: read_tool_result(');
          expect(page.length).toBeLessThan(8192);
          expect(page).not.toContain('Tool result shortened');
          return fauxAssistantMessage(facts.join('\n'));
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Read the six facts in the middle of the supplied public document.',
        mode: 'send',
        requestId: 'middle-evidence',
      });
      await idle(f);
      const snapshot = f.runtime.getSnapshot(f.session.id);
      expect(snapshot.tools.map(({ name, status }) => ({ name, status }))).toEqual([
        { name: 'web_fetch', status: 'completed' },
        { name: 'search_session_history', status: 'completed' },
        { name: 'read_tool_result', status: 'completed' },
      ]);
      expect(snapshot.messages.at(-1)?.text).toBe(facts.join('\n'));
      expect(headers).toEqual([token]);
      expect(JSON.stringify(contexts)).not.toContain(token);
      const log = await streamText(f.store.exportSessionLog(f.session.id).content);
      expect(log).toContain('read_tool_result');
      expect(log).toContain(facts[5]);
      expect(log).not.toContain(token);
      expect(f.errors).toEqual([]);
    } finally {
      try {
        await f?.close();
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  });

  it('pages completed and failed results exactly, permits an empty final page and rejects other sessions or abandoned branches', async () => {
    const f = await fixture(true);
    try {
      await writeFile(
        join(f.root, 'source.txt'),
        'Exact "quoted" text\tand a newline\n'.repeat(250),
      );
      const checkpoint = await f.work.createCheckpoint(f.session.id, {
        expectedBranchId: f.session.activeBranchId,
        label: 'Before reading',
      });
      const saved = checkpoint.checkpoints[0];
      if (!saved) throw new Error('Missing initial checkpoint');
      f.faux.setResponses([
        call('read_file', { path: 'source.txt', maxLines: 500 }),
        call('read_file', { path: 'missing.txt' }, 'missing'),
        fauxAssistantMessage('Recorded successful and failed reads.'),
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Read both files.',
        mode: 'send',
        requestId: 'record-result-text',
      });
      await idle(f);
      const [completed, failed] = f.runtime.getSnapshot(f.session.id).tools;
      if (!completed || completed.result === null || !failed || failed.result === null)
        throw new Error('Missing retained results');
      const completedText = completed.result;
      expect(failed.status).toBe('failed');
      const pages = [];
      for (let offset = 0; offset < completed.result.length; offset += 1000) {
        const page = f.work.readToolResult(f.session.id, completed.id, offset, 1000);
        expect(page).toContain(`Tool ID: ${completed.id}`);
        expect(page).toContain('Status: completed');
        expect(page).not.toContain('fingerprint');
        pages.push(pageText(page));
      }
      expect(pages.join('')).toBe(completed.result);
      const empty = f.work.readToolResult(
        f.session.id,
        completed.id,
        completed.result.length,
        1000,
      );
      expect(pageText(empty)).toBe('');
      expect(empty).toContain('Next: none');
      const failedPage = f.work.readToolResult(f.session.id, failed.id, 0, 6000);
      expect(failedPage).toContain('Status: failed');
      expect(pageText(failedPage)).toBe(failed.result);
      expect(() =>
        f.work.readToolResult(f.session.id, completed.id, completedText.length + 1, 1000),
      ).toThrow(expect.objectContaining({ code: 'TOOL_RESULT_OFFSET_INVALID' }));
      expect(() => f.work.readToolResult(f.session.id, 'missing-id', 0, 1000)).toThrow(
        expect.objectContaining({ code: 'TOOL_RESULT_UNAVAILABLE' }),
      );
      const other = f.runtime.createSession({
        title: 'Other session',
        providerId: f.faux.provider.id,
        modelId: f.faux.models[0].id,
        thinkingLevel: 'off',
        workspaceId: null,
        approvalMode: 'ask',
      });
      expect(() => f.work.readToolResult(other.id, completed.id, 0, 1000)).toThrow(
        expect.objectContaining({ code: 'TOOL_RESULT_UNAVAILABLE' }),
      );
      const state = f.work.snapshot(f.session.id).state;
      await f.work.restore(f.session.id, saved.id, {
        expectedBranchId: state.branchId,
        revision: state.revision,
      });
      expect(() => f.work.readToolResult(f.session.id, completed.id, 0, 1000)).toThrow(
        expect.objectContaining({ code: 'TOOL_RESULT_UNAVAILABLE' }),
      );
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('does not read a tool that is still waiting for the user', async () => {
    const f = await fixture();
    try {
      f.faux.setResponses([call('ask_user', questionArgs('Wait for confirmation.'))]);
      await f.runtime.send(f.session.id, {
        text: 'Ask before continuing.',
        mode: 'send',
        requestId: 'pending-result',
      });
      await observe(f.runtime, f.session.id, (snapshot) =>
        snapshot.tools.some(({ name, status }) => name === 'ask_user' && status === 'running'),
      );
      const pending = f.runtime.getSnapshot(f.session.id).tools[0];
      if (!pending) throw new Error('Missing waiting tool');
      expect(() => f.work.readToolResult(f.session.id, pending.id, 0, 6000)).toThrow(
        expect.objectContaining({ code: 'TOOL_RESULT_UNAVAILABLE' }),
      );
      await f.runtime.cancel(f.session.id);
      await idle(f);
    } finally {
      await f.close();
    }
  });

  it('rejects invalid pagination JSON in the common model tool path before reading history', async () => {
    const f = await fixture(false, { context: false });
    const read = vi.spyOn(f.work, 'readToolResult');
    const invalid = [
      { toolCallId: 'unread', offset: -1 },
      { toolCallId: 'unread', offset: 0.5 },
      { toolCallId: 'unread', offset: 128_001 },
      { toolCallId: 'unread', maxCharacters: 0 },
      { toolCallId: 'unread', maxCharacters: 6001 },
      { toolCallId: 'unread', maxCharacters: 1.5 },
      { toolCallId: 'unread', unexpected: true },
    ];
    try {
      let failures = 0;
      f.faux.setResponses([
        ...invalid.map((args, index) => (context: TranscriptContext) => {
          failures = context.messages.filter(
            (message) => message.role === 'toolResult' && message.isError,
          ).length;
          return call('read_tool_result', args, `invalid-page-${index}`);
        }),
        (context) => {
          failures = context.messages.filter(
            (message) => message.role === 'toolResult' && message.isError,
          ).length;
          return fauxAssistantMessage('Invalid pages were rejected.');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Exercise invalid read requests.',
        mode: 'send',
        requestId: 'invalid-result-pages',
      });
      await idle(f);
      expect(failures).toBe(invalid.length);
      expect(read).not.toHaveBeenCalled();
      expect(f.errors).toEqual([]);
    } finally {
      read.mockRestore();
      await f.close();
    }
  });
});
