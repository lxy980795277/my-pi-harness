import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Resolve the public desktop OAuth setting without copying private daemon configuration.
 * @param {string} root Repository directory containing the optional development .env.
 * @param {Readonly<Record<string, string | undefined>>} environment Explicit build overrides.
 * @returns {Promise<string>} A single validated Client ID assignment for the packaged daemon.
 */
export async function desktopOAuthEnvironment(root, environment = process.env) {
  let source = '';
  try {
    source = await readFile(join(root, '.env'), 'utf8');
  } catch (error) {
    // A missing local file is allowed when the build environment supplies the Client ID.
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const configured = parseEnv(source);
  let clientId = environment['MY_PI_HARNESS_GITHUB_CLIENT_ID'];
  if (clientId === undefined) clientId = configured['MY_PI_HARNESS_GITHUB_CLIENT_ID'];
  if (clientId === undefined || !/^[A-Za-z0-9._-]{1,200}$/.test(clientId)) {
    throw new Error('桌面打包需要有效的 MY_PI_HARNESS_GITHUB_CLIENT_ID，请配置根 .env');
  }
  return `MY_PI_HARNESS_GITHUB_CLIENT_ID=${clientId}\n`;
}
