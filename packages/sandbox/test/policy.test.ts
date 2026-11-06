import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectProcess, resolveProcess, type ProcessInput } from '../src/index';

let directory: string;
let input: ProcessInput;
let resource: string;
let sibling: string;

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'sandbox-policy-')));
  const workspaceRoot = join(directory, 'workspace');
  const profileDirectory = join(directory, 'profile');
  resource = join(directory, 'resource');
  sibling = join(directory, 'sibling');
  for (const path of [workspaceRoot, profileDirectory, resource, sibling]) await mkdir(path);
  for (const path of [resource, sibling, profileDirectory])
    await writeFile(join(path, 'file'), 'controlled');
  input = {
    command: process.execPath,
    args: [],
    workspaceRoot,
    profileDirectory,
    environment: {},
    scope: 'sandboxed',
    readOnlyDirectories: [resource],
  };
});
afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

async function run(code: string, overrides: Partial<ProcessInput> = {}) {
  return await collectProcess(
    await resolveProcess({ ...input, ...overrides, args: ['-e', code] }),
    new AbortController().signal,
  );
}

describe.skipIf(process.platform !== 'darwin')('actual macOS access policies', () => {
  it('executes a read-only resource without granting siblings, writes, or private data', async () => {
    const code = `const fs=require('node:fs'); const read=(p)=>{try{return fs.readFileSync(p,'utf8')}catch{return 'denied'}}; const write=(p)=>{try{fs.writeFileSync(p,'changed');return 'written'}catch{return 'denied'}}; console.log(JSON.stringify({resource:read(${JSON.stringify(join(resource, 'file'))}),sibling:read(${JSON.stringify(join(sibling, 'file'))}),profile:read(${JSON.stringify(join(input.profileDirectory, 'file'))}),resourceWrite:write(${JSON.stringify(join(resource, 'file'))}),workspaceWrite:write('result.txt')}));`;
    const result = await run(code, { access: 'read-only', scope: 'full-access' });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      resource: 'controlled',
      sibling: 'denied',
      profile: 'denied',
      resourceWrite: 'denied',
      workspaceWrite: 'denied',
    });
    expect(await readFile(join(resource, 'file'), 'utf8')).toBe('controlled');
  });

  it('permits workspace writes while protecting an exact resource directory and sensitive names', async () => {
    await writeFile(join(input.workspaceRoot, '.eNv.fixture'), 'controlled-sensitive-fixture');
    await mkdir(join(input.workspaceRoot, '.SsH'));
    await writeFile(join(input.workspaceRoot, '.SsH', 'file'), 'controlled-sensitive-fixture');
    await symlink(sibling, join(input.workspaceRoot, 'escape'));
    const result = await run(
      `const fs=require('node:fs');fs.writeFileSync('allowed','written');for(const p of ${JSON.stringify(['.eNv.fixture', '.SsH/file', 'escape/file', join(resource, 'file'), join(input.profileDirectory, 'file')])}){try{if(p===${JSON.stringify(join(resource, 'file'))})fs.writeFileSync(p,'bad');else fs.readFileSync(p);console.log('unexpected')}catch{console.log('denied')}}`,
    );
    expect(result.code).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual(Array(5).fill('denied'));
    expect(await readFile(join(input.workspaceRoot, 'allowed'), 'utf8')).toBe('written');
  });

  it('preserves full-access host rights for controlled files even when resource directories are listed', async () => {
    const result = await run(
      `const fs=require('node:fs');for(const p of ${JSON.stringify([join(resource, 'file'), join(sibling, 'file'), join(input.profileDirectory, 'file')])})fs.writeFileSync(p,'host-write');console.log('done')`,
      { scope: 'full-access' },
    );
    expect(result).toMatchObject({ code: 0, stdout: 'done\n' });
    for (const path of [resource, sibling, input.profileDirectory])
      expect(await readFile(join(path, 'file'), 'utf8')).toBe('host-write');
  });

  it('keeps restricted local networking denied and full-access networking on the host', async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.end('controlled-response');
    });
    try {
      await new Promise<void>((accept) => {
        server.listen(0, '127.0.0.1', accept);
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing fixture port');
      const code = `fetch('http://127.0.0.1:${address.port}').then(r=>r.text()).then(t=>console.log(t)).catch(()=>console.log('denied'))`;
      expect((await run(code)).stdout).toBe('denied\n');
      expect(requests).toBe(0);
      expect((await run(code, { scope: 'full-access' })).stdout).toBe('controlled-response\n');
      expect(requests).toBe(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((accept, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else accept();
        });
      });
    }
  });

  it('rejects private, aliased and replaced resource directories before launch', async () => {
    await symlink(resource, join(directory, 'alias'));
    for (const path of [input.profileDirectory, directory, join(directory, 'alias')])
      await expect(
        resolveProcess({ ...input, readOnlyDirectories: [path] }),
      ).rejects.toHaveProperty('code', 'INVALID_RESOURCE');
  });

  it('keeps concurrent workspace and read-only instances independent', async () => {
    const [readOnly, writable] = await Promise.all([
      run(
        "try{require('node:fs').writeFileSync('forbidden','bad');console.log('unexpected')}catch{console.log('denied')}",
        { access: 'read-only' },
      ),
      run("require('node:fs').writeFileSync('allowed','good');console.log('written')"),
    ]);
    expect(readOnly.stdout).toBe('denied\n');
    expect(writable.stdout).toBe('written\n');
    await expect(readFile(join(input.workspaceRoot, 'forbidden'))).rejects.toHaveProperty(
      'code',
      'ENOENT',
    );
  });
});
