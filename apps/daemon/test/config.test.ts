import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DaemonConfigError, loadDaemonConfig } from '../src/config.js';

const temporaryLogRoot = join(tmpdir(), 'my-pi-config-fixture', '.my-pi-harness');

describe('daemon startup configuration', () => {
  it('defaults logs to the source repository independently of the launch directory', () => {
    const config = loadDaemonConfig({}, join(tmpdir(), 'unrelated-launch-directory'));
    expect(config.sessionLogRoot).toBe(
      fileURLToPath(new URL('../../../.my-pi-harness', import.meta.url)),
    );
    expect(config.profileDirectory).not.toBe(config.sessionLogRoot);
  });

  it('keeps custom profiles independent of the repository root and accepts an explicit log root', () => {
    const profile = join(homedir(), 'fixture-profile');
    expect(loadDaemonConfig({ MY_PI_HARNESS_PROFILE_DIRECTORY: profile }).sessionLogRoot).toBe(
      fileURLToPath(new URL('../../../.my-pi-harness', import.meta.url)),
    );
    const logs = join(tmpdir(), 'fixture-repository', '.my-pi-harness');
    expect(
      loadDaemonConfig({
        MY_PI_HARNESS_PROFILE_DIRECTORY: profile,
        MY_PI_HARNESS_SESSION_LOG_ROOT: logs,
      }),
    ).toMatchObject({ profileDirectory: profile, sessionLogRoot: logs });
  });

  it.each(['', '.my-pi-harness', './.my-pi-harness', join(homedir(), 'arbitrary-logs')])(
    'rejects unsafe or ambiguously named session log roots: %j',
    (root) => {
      expect(() => loadDaemonConfig({ MY_PI_HARNESS_SESSION_LOG_ROOT: root })).toThrow(
        DaemonConfigError,
      );
    },
  );

  it('fixes the loopback host and permits an assigned port', () => {
    expect(
      loadDaemonConfig({
        MY_PI_HARNESS_SESSION_LOG_ROOT: temporaryLogRoot,
        MY_PI_HARNESS_PORT: '0',
        HOST: '0.0.0.0',
      }).host,
    ).toBe('127.0.0.1');
    expect(
      loadDaemonConfig({
        MY_PI_HARNESS_SESSION_LOG_ROOT: temporaryLogRoot,
        MY_PI_HARNESS_PORT: '0',
      }).port,
    ).toBe(0);
  });

  it.each(['', '-1', '65536', '1.5', '4311abc', ' 4311 ', '9007199254740992'])(
    'rejects an invalid port: %j',
    (port) => {
      expect(() =>
        loadDaemonConfig({
          MY_PI_HARNESS_SESSION_LOG_ROOT: temporaryLogRoot,
          MY_PI_HARNESS_PORT: port,
        }),
      ).toThrow(DaemonConfigError);
    },
  );

  it('does not allow a parent monitor that watches the daemon itself', () => {
    expect(() =>
      loadDaemonConfig({
        MY_PI_HARNESS_SESSION_LOG_ROOT: temporaryLogRoot,
        MY_PI_HARNESS_PARENT_PID: String(process.pid),
      }),
    ).toThrow(DaemonConfigError);
  });

  it.each(['0', '2147483648', '9007199254740991'])(
    'rejects a parent PID outside the process probe range: %j',
    (parentPid) => {
      expect(() =>
        loadDaemonConfig({
          MY_PI_HARNESS_SESSION_LOG_ROOT: temporaryLogRoot,
          MY_PI_HARNESS_PARENT_PID: parentPid,
        }),
      ).toThrow(DaemonConfigError);
    },
  );

  it('accepts the largest PID supported by the process probe', () => {
    expect(
      loadDaemonConfig({
        MY_PI_HARNESS_SESSION_LOG_ROOT: temporaryLogRoot,
        MY_PI_HARNESS_PARENT_PID: '2147483647',
      }).parentPid,
    ).toBe(2_147_483_647);
  });

  it('resolves web assets relative to the configured launch directory', () => {
    expect(
      loadDaemonConfig(
        { MY_PI_HARNESS_SESSION_LOG_ROOT: temporaryLogRoot, MY_PI_HARNESS_WEB_DIST_PATH: './web' },
        '/app',
      ).webDistPath,
    ).toMatch(/[/\\]app[/\\]web$/);
  });
});
