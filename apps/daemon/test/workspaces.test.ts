import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { openProfileStore, type ProfileStore } from '@my-pi-harness/storage';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '../src/features/workspaces/service.js';

const owned: { directory: string; store: ProfileStore }[] = [];
afterEach(async () => {
  for (const item of owned.splice(0)) {
    item.store.close();
    await rm(item.directory, { recursive: true, force: true });
  }
});

async function fixture(): Promise<{
  directory: string;
  project: string;
  profile: string;
  service: WorkspaceService;
  store: ProfileStore;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-workspace-service-'));
  const project = join(directory, 'project');
  const profile = join(directory, 'profile');
  await mkdir(project);
  const store = await openProfileStore(profile);
  owned.push({ directory, store });
  return { directory, project, profile, store, service: new WorkspaceService(store, profile) };
}

describe('workspace directory ownership', () => {
  it('registers a real directory once and leaves files intact when its metadata is removed', async () => {
    const { directory, project, service } = await fixture();
    const alias = join(directory, 'alias');
    await symlink(project, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(join(project, 'keep.txt'), 'Existing user file');
    const workspace = await service.create({ rootPath: alias });
    expect(workspace.rootPath).toBe(await realpath(project));
    expect(workspace.name).toBe('project');
    expect(workspace.icon).toBe('folder');
    await expect(service.create({ rootPath: project })).rejects.toThrow('already exists');
    expect(
      service.rename(workspace.id, { name: ' Renamed ', icon: 'code', expectedRevision: 1 }),
    ).toMatchObject({ name: 'Renamed', icon: 'code', revision: 2 });
    expect(() => service.rename(workspace.id, { name: 'Stale', expectedRevision: 1 })).toThrow(
      'revision',
    );
    service.archive(workspace.id);
    expect(service.list()).toEqual([]);
    expect(await readFile(join(project, 'keep.txt'), 'utf8')).toBe('Existing user file');
  });

  it('keeps a selected icon when older callers update the name alone', async () => {
    const { project, service } = await fixture();
    const workspace = await service.create({ rootPath: project, icon: 'database' });
    expect(workspace.icon).toBe('database');
    expect(
      service.rename(workspace.id, { name: 'New name', expectedRevision: workspace.revision }),
    ).toMatchObject({ name: 'New name', icon: 'database', revision: 2 });
  });

  it('rejects missing, relative, file and protected profile directories before metadata is saved', async () => {
    const { directory, project, profile, service } = await fixture();
    const file = join(project, 'file.txt');
    await writeFile(file, 'text');
    for (const rootPath of [
      'relative/project',
      join(directory, 'missing'),
      file,
      parse(project).root,
      homedir(),
      profile,
      directory,
    ])
      await expect(service.create({ rootPath })).rejects.toThrow();
    const internal = join(profile, 'internal');
    await mkdir(internal);
    await expect(service.create({ rootPath: internal })).rejects.toThrow('应用数据目录');
    await expect(service.create({ rootPath: project, name: '   ' })).rejects.toThrow('不能为空');
    expect(service.list()).toEqual([]);
  });

  it.each(['x'.repeat(160), `${'x'.repeat(119)}🚀tail`])(
    'derives a protocol-sized display name without changing the full directory path',
    async (directoryName) => {
      const { directory, service } = await fixture();
      const rootPath = join(directory, directoryName);
      await mkdir(rootPath);
      const workspace = await service.create({ rootPath });
      expect(workspace.name).toBe(Array.from(directoryName).slice(0, 120).join(''));
      expect(workspace.rootPath).toBe(await realpath(rootPath));
      expect(service.list()).toEqual([workspace]);
    },
  );

  it.each(['.git', '.ssh', '.env-private'])(
    'rejects a sensitive root or its descendant during registration',
    async (name) => {
      const { directory, service } = await fixture();
      const rootPath = join(directory, name);
      const descendant = join(rootPath, 'project');
      await mkdir(descendant, { recursive: true });
      await expect(service.create({ rootPath })).rejects.toMatchObject({
        code: 'WORKSPACE_PATH_PROTECTED',
      });
      await expect(service.create({ rootPath: descendant })).rejects.toMatchObject({
        code: 'WORKSPACE_PATH_PROTECTED',
      });
      expect(service.list()).toEqual([]);
    },
  );

  it('validates the registered identity again and never defaults an unassigned session to the process directory', async () => {
    const { directory, project, service } = await fixture();
    expect(await service.resolveSessionInput({ title: 'Plain chat' })).toEqual({
      title: 'Plain chat',
      workspaceId: null,
      approvalMode: 'ask',
    });
    await expect(
      service.resolveSessionInput({ title: 'Missing', workspaceId: 'missing' }),
    ).rejects.toThrow('工作区不存在');
    const workspace = await service.create({ rootPath: project });
    expect(
      await service.resolveSessionInput({
        title: 'Project chat',
        workspaceId: workspace.id,
        approvalMode: 'read-only',
      }),
    ).toMatchObject({ workspaceId: workspace.id, approvalMode: 'read-only' });
    await rename(project, join(directory, 'retired'));
    const replacement = join(directory, 'replacement');
    await mkdir(replacement);
    await symlink(replacement, project, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(service.requireAvailable(workspace.id)).rejects.toThrow('目录已改变');
  });
});
