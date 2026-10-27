import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialWorkState } from '@my-pi-harness/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSystemContext } from '../src/context/system-context.js';
import { loadWorkspaceRules } from '../src/context/rules.js';

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), 'my-pi-context-rules-'));
  directories.push(temporary);
  const directory = await realpath(temporary);
  const workspaceRoot = join(directory, 'workspace');
  const profileDirectory = join(directory, 'profile');
  await mkdir(workspaceRoot);
  await mkdir(profileDirectory);
  return { directory, workspaceRoot, profileDirectory, signal: new AbortController().signal };
}

describe('workspace rule discovery', () => {
  it('loads only referenced ancestors, freezes bytes and reloads changed rules on the next call', async () => {
    const f = await fixture();
    await mkdir(join(f.workspaceRoot, 'src', 'feature'), { recursive: true });
    await mkdir(join(f.workspaceRoot, 'unrelated'));
    await writeFile(join(f.workspaceRoot, 'AGENTS.md'), 'Root instructions\n');
    await writeFile(join(f.workspaceRoot, 'src', 'AGENTS.md'), 'Source instructions\n');
    await writeFile(join(f.workspaceRoot, 'src', 'feature', 'AGENTS.md'), '深层规则\n');
    await writeFile(join(f.workspaceRoot, 'src', 'feature', 'file.txt'), 'reference');
    await writeFile(join(f.workspaceRoot, 'unrelated', 'AGENTS.md'), 'Must not load');
    const input = { ...f, referencePaths: ['src/feature/file.txt', 'src/feature/file.txt'] };
    const rules = await loadWorkspaceRules(input);
    expect(rules.map(({ path }) => path)).toEqual([
      'AGENTS.md',
      'src/AGENTS.md',
      'src/feature/AGENTS.md',
    ]);
    expect(rules[2]).toMatchObject({
      content: '深层规则\n',
      byteLength: Buffer.byteLength('深层规则\n'),
      hash: createHash('sha256').update('深层规则\n').digest('hex'),
    });
    await writeFile(join(f.workspaceRoot, 'AGENTS.md'), 'Changed root rules');
    const next = await loadWorkspaceRules(input);
    expect(next[0]?.content).toBe('Changed root rules');
    expect(next[0]?.hash).not.toBe(rules[0]?.hash);
    expect(rules[0]?.content).toBe('Root instructions\n');
  });

  it('allows absent rules without recursively scanning a workspace', async () => {
    const f = await fixture();
    await mkdir(join(f.workspaceRoot, 'other'));
    await writeFile(join(f.workspaceRoot, 'other', 'AGENTS.md'), 'Unreferenced');
    expect(await loadWorkspaceRules(f)).toEqual([]);
    await writeFile(join(f.workspaceRoot, 'other', 'file.txt'), 'reference');
    expect(
      (await loadWorkspaceRules({ ...f, referencePaths: ['other/file.txt'] }))[0]?.content,
    ).toBe('Unreferenced');
  });

  it('keeps ancestor rules for a deleted source and skips missing directories without following aliases', async () => {
    const f = await fixture();
    await mkdir(join(f.workspaceRoot, 'src'));
    await writeFile(join(f.workspaceRoot, 'AGENTS.md'), 'Root rule');
    await writeFile(join(f.workspaceRoot, 'src', 'AGENTS.md'), 'Source rule');
    await writeFile(join(f.workspaceRoot, 'src', 'deleted.txt'), 'Frozen reference');
    await rm(join(f.workspaceRoot, 'src', 'deleted.txt'));
    const input = { ...f, referencePaths: ['src/deleted.txt'] };
    expect((await loadWorkspaceRules(input)).map(({ path }) => path)).toEqual([
      'AGENTS.md',
      'src/AGENTS.md',
    ]);
    await rm(join(f.workspaceRoot, 'src'), { recursive: true });
    expect((await loadWorkspaceRules(input)).map(({ path }) => path)).toEqual(['AGENTS.md']);
    await symlink(f.profileDirectory, join(f.workspaceRoot, 'src'));
    await expect(loadWorkspaceRules(input)).rejects.toMatchObject({ code: 'SYMLINK_PATH' });
  });

  it('rejects rule symlinks and hardlinks, even when their targets are inside the workspace', async () => {
    const f = await fixture();
    await writeFile(join(f.workspaceRoot, 'rules.txt'), 'Aliased');
    await symlink(join(f.workspaceRoot, 'rules.txt'), join(f.workspaceRoot, 'AGENTS.md'));
    await expect(loadWorkspaceRules(f)).rejects.toMatchObject({ code: 'SYMLINK_PATH' });
    await rm(join(f.workspaceRoot, 'AGENTS.md'));
    await link(join(f.workspaceRoot, 'rules.txt'), join(f.workspaceRoot, 'AGENTS.md'));
    await expect(loadWorkspaceRules(f)).rejects.toMatchObject({ code: 'HARDLINK_FILE' });
  });

  it('rejects escaped, protected and symlinked references instead of loading their ancestor rules', async () => {
    const f = await fixture();
    await mkdir(join(f.workspaceRoot, '.git'));
    await writeFile(join(f.workspaceRoot, '.git', 'config'), 'private');
    await symlink(f.profileDirectory, join(f.workspaceRoot, 'linked'));
    await expect(
      loadWorkspaceRules({ ...f, referencePaths: ['../profile'] }),
    ).rejects.toMatchObject({ code: 'PROTECTED_PATH' });
    await expect(
      loadWorkspaceRules({ ...f, referencePaths: ['.git/config'] }),
    ).rejects.toMatchObject({ code: 'PROTECTED_PATH' });
    await expect(
      loadWorkspaceRules({ ...f, referencePaths: ['.env.local'] }),
    ).rejects.toMatchObject({ code: 'PROTECTED_PATH' });
    await expect(loadWorkspaceRules({ ...f, referencePaths: ['linked'] })).rejects.toMatchObject({
      code: 'SYMLINK_PATH',
    });
    await expect(
      loadWorkspaceRules({ ...f, workspaceRoot: f.profileDirectory }),
    ).rejects.toMatchObject({ code: 'PROTECTED_PATH' });
  });

  it('enforces the aggregate byte and source-count limits without truncating rule text', async () => {
    const f = await fixture();
    await mkdir(join(f.workspaceRoot, 'child'));
    await writeFile(join(f.workspaceRoot, 'AGENTS.md'), 'a'.repeat(40_000));
    await writeFile(join(f.workspaceRoot, 'child', 'AGENTS.md'), 'b'.repeat(30_000));
    await expect(loadWorkspaceRules({ ...f, referencePaths: ['child'] })).rejects.toMatchObject({
      code: 'RULE_LIMIT',
    });
    await writeFile(join(f.workspaceRoot, 'AGENTS.md'), 'root');
    const references: string[] = [];
    for (let index = 0; index < 16; index += 1) {
      const name = `directory-${index}`;
      references.push(name);
      await mkdir(join(f.workspaceRoot, name));
      await writeFile(join(f.workspaceRoot, name, 'AGENTS.md'), 'small');
    }
    await expect(loadWorkspaceRules({ ...f, referencePaths: references })).rejects.toMatchObject({
      code: 'RULE_LIMIT',
    });
  });

  it('rejects binary rules and cancelled loads', async () => {
    const f = await fixture();
    await writeFile(join(f.workspaceRoot, 'AGENTS.md'), Buffer.from([0xff, 0xfe]));
    await expect(loadWorkspaceRules(f)).rejects.toMatchObject({ code: 'INVALID_RULE_FILE' });
    await writeFile(join(f.workspaceRoot, 'AGENTS.md'), 'text\0binary');
    await expect(loadWorkspaceRules(f)).rejects.toMatchObject({ code: 'INVALID_RULE_FILE' });
    const controller = new AbortController();
    controller.abort();
    await expect(loadWorkspaceRules({ ...f, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('scopes ordered rules below policy and treats plans and summaries as saved data', async () => {
    const f = await fixture();
    await writeFile(join(f.workspaceRoot, 'AGENTS.md'), 'Workspace instructions');
    const rules = await loadWorkspaceRules(f);
    const state = initialWorkState('branch');
    state.mode = 'plan';
    state.plan = {
      id: 'plan',
      runId: null,
      steps: [],
      review: 'approved',
      feedback: null,
      title: 'Plan',
      content: 'Do work',
      status: 'approved',
      updatedAt: 1,
    };
    state.compaction = {
      parentId: null,
      structured: {
        objective: '',
        constraints: [],
        decisions: [],
        completed: [],
        pending: [],
        blockers: [],
        nextAction: '',
      },
      strategy: 'model',
      beforeTokens: 100,
      afterTokens: 50,
      sourceMessages: 2,
      runId: null,
      id: 'summary',
      summary: 'Historical facts',
      throughMessageId: 'old',
      createdAt: 1,
      reason: 'manual',
    };
    const prompt = buildSystemContext('Application policy', rules, state);
    expect(prompt.startsWith('Application policy')).toBe(true);
    expect(prompt).toContain('Application policy and tool permissions always take precedence');
    expect(prompt).toContain('deeper files take precedence');
    expect(prompt).toContain('Plan approval never grants tool permission');
    expect(prompt).toContain('"previousSummary":"Historical facts"');
    expect(prompt).toContain('"path":"AGENTS.md"');
    expect(prompt).not.toContain(f.workspaceRoot);
  });
});
