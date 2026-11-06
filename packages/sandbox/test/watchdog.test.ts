import { execFile, spawn } from 'node:child_process';
import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WATCHDOG_SOURCE } from '../src/process/watchdog.js';

async function running(pid: number): Promise<boolean> {
  return await new Promise<boolean>((accept, reject) => {
    execFile('/bin/ps', ['-p', String(pid), '-o', 'stat='], { timeout: 1000 }, (error, stdout) => {
      if (error && error.code !== 1) {
        reject(new Error('Fixture process inspection failed', { cause: error }));
        return;
      }
      const status = stdout.trim();
      accept(status !== '' && !status.startsWith('Z'));
    });
  });
}

describe.skipIf(process.platform !== 'darwin')('independent daemon-crash watchdog', () => {
  it.each([
    "process.on('SIGTERM',()=>{});console.log(JSON.stringify({pid:process.pid}));setInterval(()=>{},1000)",
    "const{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});process.send(process.pid);setInterval(()=>{},1000)\"],{stdio:['ignore','inherit','inherit','ipc']});c.once('message',pid=>console.log(JSON.stringify({pid})))",
  ])(
    'reclaims the owned group and temporary files after daemon SIGKILL (%#)',
    async (targetCode) => {
      const temporary = await realpath(await mkdtemp(join(tmpdir(), 'watchdog-crash-fixture-')));
      const configuration = {
        command: process.execPath,
        args: ['-e', targetCode],
        cwd: temporary,
        env: {},
        terminateGraceMs: 100,
        killWaitMs: 2000,
        pipeCloseMs: 2000,
        temporaryDirectory: temporary,
      };
      const daemon = spawn(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import{spawn}from'node:child_process';const watcher=spawn(process.execPath,['--input-type=module','-e',${JSON.stringify(WATCHDOG_SOURCE)}],{detached:true,stdio:['pipe','pipe','pipe','pipe','pipe']});console.log(JSON.stringify({watchdog:watcher.pid}));watcher.stdout.pipe(process.stdout);watcher.stderr.pipe(process.stderr);let status='';watcher.stdio[4].on('data',b=>{status+=b.toString();for(;;){const end=status.indexOf('\\n');if(end<0)break;const m=JSON.parse(status.slice(0,end));status=status.slice(end+1);if(m.type==='started')console.log(JSON.stringify({group:m.pid}));}});watcher.stdio[3].write(${JSON.stringify(JSON.stringify(configuration) + '\n')});`,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let watchdog: number | undefined;
      let target: number | undefined;
      let group: number | undefined;
      let timer: NodeJS.Timeout | undefined;
      const closed = new Promise<void>((accept) => {
        daemon.once('close', accept);
      });
      try {
        let pending = '';
        const ready = new Promise<void>((accept, reject) => {
          daemon.once('error', reject);
          daemon.once('exit', () => {
            if (!target) reject(new Error('Fixture daemon exited before its program was ready'));
          });
          daemon.stdout.on('data', (chunk: Buffer) => {
            pending += chunk.toString();
            for (;;) {
              const end = pending.indexOf('\n');
              if (end < 0) break;
              const value: unknown = JSON.parse(pending.slice(0, end));
              pending = pending.slice(end + 1);
              if (typeof value !== 'object' || !value) continue;
              if ('watchdog' in value && typeof value.watchdog === 'number')
                watchdog = value.watchdog;
              if ('group' in value && typeof value.group === 'number') group = value.group;
              if ('pid' in value && typeof value.pid === 'number') target = value.pid;
              if (watchdog && group && target) accept();
            }
          });
        });
        await Promise.race([
          ready,
          new Promise<never>((_accept, reject) => {
            timer = setTimeout(() => {
              reject(new Error('Fixture program readiness deadline'));
            }, 5000);
          }),
        ]);
        clearTimeout(timer);
        if (!watchdog || !target) throw new Error('Missing owned fixture identities');
        const targetPid = target;
        const watchdogPid = watchdog;
        expect(await running(targetPid)).toBe(true);
        daemon.kill('SIGKILL');
        await closed;
        await expect.poll(async () => await running(targetPid), { timeout: 5000 }).toBe(false);
        await expect.poll(async () => await running(watchdogPid), { timeout: 5000 }).toBe(false);
        await expect(access(temporary)).rejects.toHaveProperty('code', 'ENOENT');
      } finally {
        clearTimeout(timer);
        daemon.kill('SIGKILL');
        await closed;
        if (group) {
          try {
            process.kill(-group, 'SIGKILL');
          } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
          }
        }
        if (watchdog && (await running(watchdog))) process.kill(-watchdog, 'SIGKILL');
        await rm(temporary, { force: true, recursive: true });
      }
    },
  );
});
