import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolvePersistentProcess } from '@my-pi-harness/execution';
import { SupervisedStdioTransport } from '../src/stdio.js';

const roots: string[] = [];
const transports: SupervisedStdioTransport[] = [];
afterEach(async () => {
  await Promise.all(
    transports.splice(0).map(async (transport) => {
      await transport.close();
    }),
  );
  await Promise.all(
    roots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
});
async function transport(code: string): Promise<SupervisedStdioTransport> {
  const workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), 'mcp-stdio-workspace-')));
  const profileDirectory = await realpath(await mkdtemp(join(tmpdir(), 'mcp-stdio-profile-')));
  roots.push(workspaceRoot, profileDirectory);
  const launch = await resolvePersistentProcess({
    command: process.execPath,
    args: ['-e', code],
    workspaceRoot,
    profileDirectory,
    environment: {},
    scope: 'full-access',
  });
  const owned = new SupervisedStdioTransport(launch, [], () => {});
  transports.push(owned);
  return owned;
}

describe.skipIf(process.platform !== 'darwin')(
  'strict bounded framing around the official MCP codec',
  () => {
    it('buffers split Unicode and delivers only a complete official decoded frame', async () => {
      const owned = await transport(
        "const b=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:1,result:{text:'你好'}})+'\\n');const i=b.indexOf(Buffer.from('你'));process.stdout.write(b.subarray(0,i+1));setImmediate(()=>process.stdout.write(b.subarray(i+1)));process.stdin.resume();",
      );
      let accept: (message: unknown) => void = () => {};
      const response = new Promise<unknown>((resolve) => {
        accept = resolve;
      });
      owned.onmessage = (message) => {
        accept(message);
      };
      await owned.start();
      expect(await response).toEqual({ jsonrpc: '2.0', id: 1, result: { text: '你好' } });
      await owned.close();
    });
    it.each([
      [
        'partial EOF',
        'process.stdout.write(\'{\\"jsonrpc\\":\');process.stdout.end();process.stdin.resume();',
        'INCOMPLETE_FRAME',
      ],
      [
        'invalid UTF-8',
        'process.stdout.write(Buffer.from([255,10]));process.stdin.resume();',
        'INVALID_PROTOCOL',
      ],
      [
        'invalid JSON line',
        "process.stdout.write('garbage\\n');process.stdin.resume();",
        'INVALID_PROTOCOL',
      ],
      [
        'oversized unfinished frame',
        "process.stdout.write('x'.repeat(4*1024*1024+1));process.stdin.resume();",
        'FRAME_LIMIT',
      ],
    ])('fails %s and waits for the owned process to close', async (_name, code, expected) => {
      const owned = await transport(code);
      let rejectFrame: (error: Error) => void = () => {};
      const fault = new Promise<Error>((accept) => {
        rejectFrame = accept;
      });
      owned.onerror = (error) => {
        rejectFrame(error);
      };
      await owned.start();
      expect(await fault).toHaveProperty('code', expected);
      await owned.close();
    });
    it('bounds a flood of individually legal small frames before SDK callback queues grow', async () => {
      const owned = await transport(
        "const line=JSON.stringify({jsonrpc:'2.0',method:'notifications/message',params:{level:'info',data:'small'}})+'\\n';process.stdout.write(line.repeat(3000));process.stdin.resume();",
      );
      let observed = 0;
      let failed: (error: Error) => void = () => {};
      const fault = new Promise<Error>((accept) => {
        failed = accept;
      });
      owned.onmessage = () => {
        observed += 1;
      };
      owned.onerror = (error) => {
        failed(error);
      };
      await owned.start();
      expect(await fault).toHaveProperty('code', 'FRAME_RATE_LIMIT');
      expect(observed).toBeLessThan(3000);
      await owned.close();
    });
    it('blocks unregistered tools/call before any program has started', async () => {
      const owned = await transport('process.stdin.resume()');
      await expect(
        owned.send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'echo', arguments: {} },
        }),
      ).rejects.toHaveProperty('code', 'UNREGISTERED_DISPATCH');
    });
  },
);
