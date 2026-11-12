import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { resolveSessionLogRoot } from '../src/main/session-log-root';

describe('desktop session log root', () => {
  const paths = { developmentRoot: '/projects/my-pi-harness' };

  it('uses the repository in development and requires an explicit root outside the repository', () => {
    expect(resolveSessionLogRoot({ ...paths, packaged: false })).toBe(
      join(paths.developmentRoot, '.my-pi-harness'),
    );
    expect(() => resolveSessionLogRoot({ ...paths, packaged: true })).toThrow(
      'MY_PI_HARNESS_SESSION_LOG_ROOT',
    );
  });

  it('preserves an explicit test or development root, including invalid values for daemon rejection', () => {
    const configuredRoot = '/temporary/isolated/.my-pi-harness';
    expect(resolveSessionLogRoot({ ...paths, packaged: true, configuredRoot })).toBe(
      configuredRoot,
    );
    expect(resolveSessionLogRoot({ ...paths, packaged: false, configuredRoot: '' })).toBe('');
  });
});
