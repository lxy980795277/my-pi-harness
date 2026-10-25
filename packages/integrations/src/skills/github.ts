import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { SkillError } from './errors.js';
import { skillResourcePath } from './files.js';
import type { GitHubSkillSource, SkillDownloadFile } from './types.js';

const CommitSchema = Type.Object({ sha: Type.String({ pattern: '^[a-f0-9]{40}$' }) });
const TreeSchema = Type.Object({
  truncated: Type.Boolean(),
  tree: Type.Array(
    Type.Object({
      path: Type.String(),
      type: Type.String(),
      mode: Type.String(),
      size: Type.Optional(Type.Integer()),
      sha: Type.String(),
    }),
    { maxItems: 100000 },
  ),
});
const BlobSchema = Type.Object({
  sha: Type.String({ pattern: '^[a-f0-9]{40}$' }),
  encoding: Type.Literal('base64'),
  content: Type.String(),
  size: Type.Integer({ minimum: 0, maximum: 2097152 }),
});
/** Public GitHub source resolution pins one commit and never invokes Git or source lifecycle scripts. */
export async function downloadGitHubSkill(
  source: GitHubSkillSource,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<{ name: string; commit: string; files: SkillDownloadFile[] }> {
  if (
    !/^[A-Za-z0-9-]+$/.test(source.owner) ||
    !/^[A-Za-z0-9_.-]+$/.test(source.repository) ||
    source.repository === '.' ||
    source.repository === '..' ||
    source.ref.length === 0 ||
    source.ref.length > 200
  )
    throw new SkillError('SKILL_SOURCE', 'Invalid GitHub source');
  const prefix = source.path.replace(/\/$/, '');
  if (prefix.length > 0) skillResourcePath(prefix);
  signal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  const base = `https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}`;
  async function json(url: string, limit: number): Promise<unknown> {
    signal.throwIfAborted();
    const response = await request(url, {
      signal,
      redirect: 'error',
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!response.ok || response.body === null) {
      await response.body?.cancel();
      throw new SkillError('SKILL_DOWNLOAD', `GitHub source request failed (${response.status})`);
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const raw of response.body) {
      const chunk: unknown = raw;
      if (!(chunk instanceof Uint8Array))
        throw new SkillError('SKILL_DOWNLOAD', 'GitHub response contained non-byte data');
      size += chunk.length;
      if (size > limit) {
        throw new SkillError('SKILL_LIMIT', 'GitHub response exceeds its size limit');
      }
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (cause) {
      throw new SkillError('SKILL_DOWNLOAD', 'GitHub returned invalid JSON', { cause });
    }
  }
  const commit = await json(`${base}/commits/${encodeURIComponent(source.ref)}`, 1024 * 1024);
  if (!Value.Check(CommitSchema, commit))
    throw new SkillError('SKILL_SOURCE', 'GitHub commit response is invalid');
  const tree = await json(`${base}/git/trees/${commit.sha}?recursive=1`, 16 * 1024 * 1024);
  if (!Value.Check(TreeSchema, tree) || tree.truncated)
    throw new SkillError('SKILL_SOURCE', 'GitHub tree is invalid or truncated');
  const selected = tree.tree.filter((entry) => {
    if (prefix.length === 0) return true;
    return entry.path.startsWith(`${prefix}/`);
  });
  const files: SkillDownloadFile[] = [];
  let total = 0;
  for (const entry of selected) {
    if (entry.type === 'tree') continue;
    if (
      entry.type !== 'blob' ||
      !['100644', '100755'].includes(entry.mode) ||
      !/^[a-f0-9]{40}$/.test(entry.sha)
    )
      throw new SkillError('SKILL_SOURCE', 'GitHub Skills cannot contain links or submodules');
    const path = prefix.length === 0 ? entry.path : entry.path.slice(prefix.length + 1);
    skillResourcePath(path);
    if (
      entry.size === undefined ||
      entry.size > 2097152 ||
      files.length >= 256 ||
      total + entry.size > 16777216
    )
      throw new SkillError('SKILL_LIMIT', 'GitHub Skill exceeds resource limits');
    const blob = await json(`${base}/git/blobs/${entry.sha}`, 3 * 1024 * 1024);
    if (!Value.Check(BlobSchema, blob))
      throw new SkillError('SKILL_SOURCE', 'GitHub blob response is invalid');
    const content = Buffer.from(blob.content.replace(/\s/g, ''), 'base64');
    if (content.length !== blob.size || content.length !== entry.size)
      throw new SkillError('SKILL_SOURCE', 'GitHub blob size does not match the commit tree');
    const objectHash = createHash('sha1')
      .update(`blob ${content.length}\0`)
      .update(content)
      .digest('hex');
    if (objectHash !== entry.sha || blob.sha !== entry.sha)
      throw new SkillError('SKILL_SOURCE', 'GitHub blob does not match its pinned object identity');
    total += content.length;
    files.push({ path, content });
  }
  const name = prefix.split('/').at(-1) || source.repository;
  return { name, commit: commit.sha, files };
}
