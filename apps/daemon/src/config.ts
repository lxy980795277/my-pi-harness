import { resolve } from 'node:path';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

/** The daemon accepts connections only from the local IPv4 interface. */
export const LOOPBACK_HOST = '127.0.0.1';

const DaemonConfigSchema = Type.Object({
  host: Type.Literal(LOOPBACK_HOST),
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
  const candidate = {
    host: LOOPBACK_HOST,
    port: readInteger(environment.MY_PI_HARNESS_PORT, 'MY_PI_HARNESS_PORT', 4311),
    parentPid: readInteger(environment.MY_PI_HARNESS_PARENT_PID, 'MY_PI_HARNESS_PARENT_PID', null),
    webDistPath: webDistPath === undefined ? null : resolve(workingDirectory, webDistPath),
  };
  if (!Value.Check(DaemonConfigSchema, candidate)) {
    const firstError = [...Value.Errors(DaemonConfigSchema, candidate)][0];
    throw new DaemonConfigError(firstError?.message ?? 'Invalid daemon configuration');
  }
  if (candidate.parentPid === process.pid) {
    throw new DaemonConfigError('MY_PI_HARNESS_PARENT_PID must identify a different process');
  }
  return candidate;
}
