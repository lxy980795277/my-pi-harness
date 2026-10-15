import { isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

/** The daemon accepts connections only from the local IPv4 interface. */
export const LOOPBACK_HOST = '127.0.0.1';

const DaemonConfigSchema = Type.Object({
  host: Type.Literal(LOOPBACK_HOST),
  profileDirectory: Type.String({ minLength: 1 }),
  ownerSecret: Type.Union([Type.String({ minLength: 40, maxLength: 128 }), Type.Null()]),
  developmentOrigin: Type.Union([Type.String(), Type.Null()]),
  githubClientId: Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]),
  githubClientSecret: Type.Union([Type.String({ minLength: 1, maxLength: 1024 }), Type.Null()]),
  port: Type.Integer({ minimum: 0, maximum: 65_535 }),
  webDistPath: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  parentPid: Type.Union([Type.Integer({ minimum: 1, maximum: 2_147_483_647 }), Type.Null()]),
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

/**
 * Parse supported environment variables before opening files or listeners.
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
  if (
    configuredProfile !== undefined &&
    (!configuredProfile.trim() || !isAbsolute(configuredProfile))
  )
    throw new DaemonConfigError('MY_PI_HARNESS_PROFILE_DIRECTORY must be an absolute directory');
  const defaultData =
    process.platform === 'win32'
      ? (environment.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'))
      : join(homedir(), 'Library', 'Application Support');
  const developmentOrigin = environment.MY_PI_HARNESS_DEVELOPMENT_ORIGIN;
  if (developmentOrigin !== undefined && developmentOrigin !== 'http://127.0.0.1:5174')
    throw new DaemonConfigError('Development origin must be the owned local Web application');
  const candidate = {
    profileDirectory:
      configuredProfile ?? join(defaultData, 'My Pi Harness', 'profiles', 'default'),
    ownerSecret: environment.MY_PI_HARNESS_DESKTOP_SECRET ?? null,
    developmentOrigin: developmentOrigin ?? null,
    githubClientId: environment.MY_PI_HARNESS_GITHUB_CLIENT_ID ?? null,
    githubClientSecret: environment.MY_PI_HARNESS_GITHUB_CLIENT_SECRET ?? null,
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
  if (candidate.githubClientSecret !== null && candidate.githubClientId === null)
    throw new DaemonConfigError('GitHub client secret requires a client ID');
  if (candidate.parentPid === process.pid) {
    throw new DaemonConfigError('MY_PI_HARNESS_PARENT_PID must identify a different process');
  }
  return candidate;
}
