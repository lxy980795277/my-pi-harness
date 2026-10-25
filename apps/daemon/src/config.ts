import { basename, isAbsolute, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

/** The daemon accepts connections only from the local IPv4 interface. */
export const LOOPBACK_HOST = '127.0.0.1';

const DaemonConfigSchema = Type.Object({
  host: Type.Literal(LOOPBACK_HOST),
  profileDirectory: Type.String({ minLength: 1 }),
  sessionLogRoot: Type.String({ minLength: 1 }),
  ownerSecret: Type.Union([Type.String({ minLength: 40, maxLength: 128 }), Type.Null()]),
  developmentOrigin: Type.Union([Type.String(), Type.Null()]),
  githubClientId: Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]),
  githubClientSecret: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]),
  githubCallbackUrl: Type.Union([Type.String({ minLength: 1, maxLength: 2048 }), Type.Null()]),
  port: Type.Integer({ minimum: 0, maximum: 65_535 }),
  webDistPath: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  parentPid: Type.Union([Type.Integer({ minimum: 1, maximum: 2_147_483_647 }), Type.Null()]),
  officePythonPath: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
});

/** Validated startup settings. Port zero requests an available port. */
export type DaemonConfig = Static<typeof DaemonConfigSchema>;

/** A startup setting cannot be interpreted without changing its value. */
export class DaemonConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'DaemonConfigError';
  }
}

function readInteger(
  value: string | undefined,
  name: string,
  fallback: number | null,
): number | null {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new DaemonConfigError(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new DaemonConfigError(`${name} must be a safe integer`);
  return parsed;
}

function repositorySessionLogRoot(): string {
  const repository = fileURLToPath(new URL('../../../', import.meta.url));
  if (!existsSync(join(repository, 'pnpm-workspace.yaml')))
    throw new DaemonConfigError(
      'Set MY_PI_HARNESS_SESSION_LOG_ROOT to the repository .my-pi-harness directory when launching outside the repository',
    );
  return join(repository, '.my-pi-harness');
}

/**
 * Parse supported environment variables before opening profile resources or listeners.
 * @param environment Environment values supplied to this daemon process.
 * @param workingDirectory Base directory for a relative web asset path.
 * @returns Settings with a fixed loopback host and validated numeric values.
 */
export function loadDaemonConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  workingDirectory: string = process.cwd(),
): DaemonConfig {
  const webDistPath = environment.MY_PI_HARNESS_WEB_DIST_PATH;
  if (webDistPath !== undefined && webDistPath.trim().length === 0) {
    throw new DaemonConfigError('MY_PI_HARNESS_WEB_DIST_PATH must not be empty');
  }
  const configuredProfile = environment.MY_PI_HARNESS_PROFILE_DIRECTORY;
  const officePythonPath = environment.MY_PI_HARNESS_OFFICE_PYTHON;
  if (officePythonPath !== undefined && (!isAbsolute(officePythonPath) || !officePythonPath.trim()))
    throw new DaemonConfigError('MY_PI_HARNESS_OFFICE_PYTHON must be an absolute executable path');
  if (
    configuredProfile !== undefined &&
    (!configuredProfile.trim() || !isAbsolute(configuredProfile))
  )
    throw new DaemonConfigError('MY_PI_HARNESS_PROFILE_DIRECTORY must be an absolute directory');
  const configuredLogRoot = environment.MY_PI_HARNESS_SESSION_LOG_ROOT;
  if (
    configuredLogRoot !== undefined &&
    (!isAbsolute(configuredLogRoot) || basename(configuredLogRoot) !== '.my-pi-harness')
  )
    throw new DaemonConfigError(
      'MY_PI_HARNESS_SESSION_LOG_ROOT must be an absolute .my-pi-harness directory',
    );
  const defaultData =
    process.platform === 'win32'
      ? (environment.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'))
      : join(homedir(), 'Library', 'Application Support');
  const developmentOrigin = environment.MY_PI_HARNESS_DEVELOPMENT_ORIGIN;
  if (developmentOrigin !== undefined && developmentOrigin !== 'http://127.0.0.1:5174')
    throw new DaemonConfigError('Development origin must be the owned local Web application');
  const githubCallbackUrl = environment.MY_PI_HARNESS_GITHUB_CALLBACK_URL;
  if (githubCallbackUrl !== undefined) validateGitHubCallbackUrl(githubCallbackUrl);
  const githubClientId = environment.MY_PI_HARNESS_GITHUB_CLIENT_ID;
  const githubClientSecret = environment.MY_PI_HARNESS_GITHUB_CLIENT_SECRET;
  if (githubClientSecret !== undefined && githubClientId === undefined)
    throw new DaemonConfigError('GitHub Client Secret requires MY_PI_HARNESS_GITHUB_CLIENT_ID');
  const candidate = {
    ...(officePythonPath === undefined ? {} : { officePythonPath }),
    profileDirectory:
      configuredProfile ?? join(defaultData, 'My Pi Harness', 'profiles', 'default'),
    sessionLogRoot: configuredLogRoot ?? repositorySessionLogRoot(),
    ownerSecret: environment.MY_PI_HARNESS_DESKTOP_SECRET ?? null,
    developmentOrigin: developmentOrigin ?? null,
    githubClientId: githubClientId ?? null,
    githubClientSecret: githubClientSecret ?? null,
    githubCallbackUrl: githubCallbackUrl ?? null,
    host: LOOPBACK_HOST,
    port: readInteger(environment.MY_PI_HARNESS_PORT, 'MY_PI_HARNESS_PORT', 4311),
    parentPid: readInteger(environment.MY_PI_HARNESS_PARENT_PID, 'MY_PI_HARNESS_PARENT_PID', null),
    webDistPath: webDistPath === undefined ? null : resolve(workingDirectory, webDistPath),
  };
  if (!isAbsolute(candidate.profileDirectory))
    throw new DaemonConfigError('Profile directory must be absolute');
  if (!Value.Check(DaemonConfigSchema, candidate)) {
    const firstError = [...Value.Errors(DaemonConfigSchema, candidate)][0];
    throw new DaemonConfigError(firstError?.message ?? 'Invalid daemon configuration');
  }
  if (candidate.parentPid === process.pid) {
    throw new DaemonConfigError('MY_PI_HARNESS_PARENT_PID must identify a different process');
  }
  return candidate;
}

function validateGitHubCallbackUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DaemonConfigError('GitHub callback must be an absolute loopback URL');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.pathname !== '/api/auth/callback/github' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new DaemonConfigError(
      'GitHub callback must be a loopback /api/auth/callback/github URL without credentials, query or fragment',
    );
}
