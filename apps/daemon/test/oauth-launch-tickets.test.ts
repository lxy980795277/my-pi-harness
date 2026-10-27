import { afterEach, expect, it, vi } from 'vitest';
import { OAuthLaunchError, OAuthLaunchTickets } from '../src/http/oauth-launch-tickets.js';

afterEach(() => {
  vi.useRealTimers();
});

function launchToken(launchUrl: string): string {
  const token = new URLSearchParams(new URL(launchUrl).hash.slice(1)).get('ticket');
  if (token === null) throw new Error('Missing launch capability');
  return token;
}

it.each(['plugin', 'mcp'] as const)(
  'launches %s in its own page without credentials and consumes its capability only once',
  (target) => {
    const tickets = new OAuthLaunchTickets(() => 'fixture-owner-and-generation');
    const launch = tickets.create(target, 'github', 'http://127.0.0.1:4311', 'GitHub');
    const url = new URL(launch.launchUrl);
    expect(url.pathname).toBe(`/${target === 'plugin' ? 'skill' : 'mcp'}-oauth/github/launch`);
    expect(url.searchParams.get('name')).toBe('GitHub');
    expect(url.searchParams.has('ticket')).toBe(false);
    expect(launchToken(launch.launchUrl)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(() => tickets.consume(target, 'github', launchToken(launch.launchUrl))).not.toThrow();
    expect(() => tickets.consume(target, 'github', launchToken(launch.launchUrl))).toThrow(
      expect.objectContaining({ code: 'OAUTH_LAUNCH_EXPIRED', status: 400 }),
    );
  },
);

it.each([
  { target: 'mcp' as const, id: 'github' },
  { target: 'plugin' as const, id: 'google' },
])('rejects another target or ID and burns the presented capability', ({ target, id }) => {
  const tickets = new OAuthLaunchTickets(() => 'fixture-owner-and-generation');
  const launch = tickets.create('plugin', 'github', 'http://127.0.0.1:4311', 'GitHub');
  const token = launchToken(launch.launchUrl);
  expect(() => tickets.consume(target, id, token)).toThrow(
    expect.objectContaining({ code: 'OAUTH_LAUNCH_EXPIRED', status: 400 }),
  );
  expect(() => tickets.consume('plugin', 'github', token)).toThrow(OAuthLaunchError);
});

it('rejects launch after its bound identity or configuration changes', () => {
  let snapshot = 'owner-1-generation-1';
  const tickets = new OAuthLaunchTickets(() => snapshot);
  const launch = tickets.create('mcp', 'github', 'http://127.0.0.1:4311', 'GitHub');
  snapshot = 'owner-2-generation-2';
  expect(() => tickets.consume('mcp', 'github', launchToken(launch.launchUrl))).toThrow(
    expect.objectContaining({ code: 'OAUTH_LAUNCH_EXPIRED', status: 400 }),
  );
});

it('rejects an expired launch and reclaims expired capacity before creating another', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T10:00:00.000Z'));
  const tickets = new OAuthLaunchTickets(() => 'fixture-owner-and-generation');
  const first = tickets.create('plugin', 'github', 'http://127.0.0.1:4311', 'GitHub');
  for (let index = 1; index < 100; index += 1)
    tickets.create('mcp', `server-${String(index)}`, 'http://127.0.0.1:4311', 'MCP');
  expect(() => tickets.create('plugin', 'github', 'http://127.0.0.1:4311', 'GitHub')).toThrow(
    expect.objectContaining({ code: 'OAUTH_LAUNCH_BUSY', status: 409 }),
  );
  vi.setSystemTime(first.expiresAt);
  expect(() => tickets.consume('plugin', 'github', launchToken(first.launchUrl))).toThrow(
    expect.objectContaining({ code: 'OAUTH_LAUNCH_EXPIRED', status: 400 }),
  );
  const next = tickets.create('mcp', 'github', 'http://127.0.0.1:4311', 'GitHub');
  expect(() => tickets.consume('mcp', 'github', launchToken(next.launchUrl))).not.toThrow();
});

it('closes both targets without reporting a plugin or Skill failure', () => {
  const tickets = new OAuthLaunchTickets(() => 'fixture-owner-and-generation');
  const plugin = tickets.create('plugin', 'github', 'http://127.0.0.1:4311', 'GitHub');
  const mcp = tickets.create('mcp', 'github', 'http://127.0.0.1:4311', 'GitHub');
  tickets.close();
  for (const [target, launch] of [
    ['plugin', plugin],
    ['mcp', mcp],
  ] as const) {
    expect(() => tickets.consume(target, 'github', launchToken(launch.launchUrl))).toThrow(
      expect.objectContaining({
        name: 'OAuthLaunchError',
        code: 'OAUTH_LAUNCH_CLOSED',
        status: 409,
      }),
    );
    expect(() => tickets.create(target, 'github', 'http://127.0.0.1:4311', 'GitHub')).toThrow(
      OAuthLaunchError,
    );
  }
});
