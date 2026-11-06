import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { downloadGitHubSkill } from '../../src/skills/github.js';

const signal = new AbortController().signal;
const sha = 'a'.repeat(40);
const source = { owner: 'example', repository: 'skills', ref: 'main', path: 'skills/example' };
/** Responses represent the public HTTP trust boundary; filesystem installation is tested separately. */
function fixture(mode = 'normal') {
  const urls: string[] = [];
  const text = '---\nname: example\ndescription: Example\n---\nDo the task.';
  const objectHash = createHash('sha1')
    .update(`blob ${Buffer.byteLength(text)}\0`)
    .update(text)
    .digest('hex');
  const request: typeof fetch = (input, options) => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    expect(options?.redirect).toBe('error');
    if (url.includes('/commits/')) return Promise.resolve(Response.json({ sha }));
    if (url.includes('/git/trees/'))
      return Promise.resolve(
        Response.json({
          truncated: mode === 'truncated',
          tree: [
            {
              path: 'skills/example/SKILL.md',
              type: 'blob',
              mode: mode === 'link' ? '120000' : '100644',
              size: Buffer.byteLength(text),
              sha: objectHash,
            },
          ],
        }),
      );
    return Promise.resolve(
      Response.json({
        sha: objectHash,
        encoding: 'base64',
        content: Buffer.from(text).toString('base64'),
        size: Buffer.byteLength(text),
      }),
    );
  };
  return { request, urls, text };
}
describe('pinned public GitHub Skill source', () => {
  it('resolves a ref once and reads its exact commit tree', async () => {
    const f = fixture();
    const downloaded = await downloadGitHubSkill(source, signal, f.request);
    expect(downloaded.commit).toBe(sha);
    expect(downloaded.name).toBe('example');
    expect(Buffer.from(downloaded.files[0]?.content ?? []).toString()).toBe(f.text);
    expect(f.urls[1]).toContain(`/git/trees/${sha}?recursive=1`);
  });
  it.each(['truncated', 'link'])('rejects incomplete or linked source trees', async (mode) => {
    const f = fixture(mode);
    await expect(downloadGitHubSkill(source, signal, f.request)).rejects.toThrow();
    expect(f.urls).toHaveLength(2);
  });
  it('rejects traversal before network and observes cancellation', async () => {
    const f = fixture();
    await expect(
      downloadGitHubSkill({ ...source, path: '../outside' }, signal, f.request),
    ).rejects.toThrow();
    expect(f.urls).toEqual([]);
    const controller = new AbortController();
    controller.abort();
    await expect(downloadGitHubSkill(source, controller.signal, f.request)).rejects.toThrow();
    expect(f.urls).toEqual([]);
  });
  it('rejects redirects and oversized streamed bodies', async () => {
    const f = fixture();
    const request: typeof fetch = (input, options) => {
      if ((input instanceof Request ? input.url : String(input)).includes('/commits/'))
        return Promise.resolve(new Response('x'.repeat(1024 * 1024 + 1), { status: 200 }));
      return f.request(input, options);
    };
    await expect(downloadGitHubSkill(source, signal, request)).rejects.toMatchObject({
      code: 'SKILL_LIMIT',
    });
  });
});
