import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Executes build helpers with argv, without interpolating paths into a shell. */
export function run(command, args, options = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) accept();
      else reject(new Error(`${command} failed (${code ?? signal})`));
    });
  });
}

async function readNodeCache(directory, name, executablePath) {
  try {
    const manifest = JSON.parse(await readFile(join(directory, `${name}.json`), 'utf8'));
    if (
      typeof manifest !== 'object' ||
      manifest === null ||
      manifest.version !== 1 ||
      typeof manifest.installation !== 'string' ||
      !manifest.installation.startsWith(`${name}-`) ||
      /[/\\]/.test(manifest.installation)
    ) {
      return undefined;
    }
    const executable = join(directory, manifest.installation, name, executablePath);
    await access(executable);
    return executable;
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof Error && 'code' in error && error.code === 'ENOENT')
    ) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Publish a cache manifest only after its private installation is complete.
 * Concurrent callers keep independent installations; replacing the manifest never mutates a binary.
 * @param directory Directory containing installation directories and manifests.
 * @param name Distribution identity shared by callers requesting the same runtime.
 * @param executablePath Executable path inside the extracted distribution directory.
 * @param prepareInstallation Prepares the distribution in the supplied private directory.
 * @returns An accessible executable referenced by a complete cache manifest.
 */
export async function prepareNodeCache(directory, name, executablePath, prepareInstallation) {
  await mkdir(directory, { recursive: true });
  const cached = await readNodeCache(directory, name, executablePath);
  if (cached !== undefined) return cached;

  const installation = await mkdtemp(join(directory, `${name}-`));
  let published = false;
  try {
    await prepareInstallation(installation);
    const executable = join(installation, name, executablePath);
    await access(executable);
    const temporaryManifest = join(installation, 'manifest.json.tmp');
    await writeFile(
      temporaryManifest,
      `${JSON.stringify({
        version: 1,
        installation: basename(installation),
      })}\n`,
    );
    await rename(temporaryManifest, join(directory, `${name}.json`));
    published = true;
    return executable;
  } finally {
    if (!published) await rm(installation, { recursive: true, force: true });
  }
}

/** Downloads the selected official Node distribution and verifies its SHA-256. */
export async function ensureNode(platform = process.platform, architecture = process.arch) {
  if (
    !['darwin', 'win32', 'linux'].includes(platform) ||
    !['x64', 'arm64'].includes(architecture)
  ) {
    throw new Error(`Unsupported Node runtime target: ${platform}/${architecture}`);
  }
  const version = (await readFile(join(root, '.node-version'), 'utf8')).trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid .node-version');
  const system = platform === 'win32' ? 'win' : platform;
  const name = `node-v${version}-${system}-${architecture}`;
  const directory = join(root, '.cache', 'node');
  const executablePath = platform === 'win32' ? 'node.exe' : 'bin/node';
  return prepareNodeCache(directory, name, executablePath, async (installation) => {
    const archiveName = `${name}.${platform === 'win32' ? 'zip' : 'tar.xz'}`;
    const origin = `https://nodejs.org/dist/v${version}/`;
    const checksums = await fetch(`${origin}SHASUMS256.txt`);
    if (!checksums.ok) throw new Error(`Cannot fetch Node checksums: ${checksums.status}`);
    const line = (await checksums.text())
      .split('\n')
      .find((entry) => entry.endsWith(`  ${archiveName}`));
    if (!line) throw new Error(`Node release does not contain ${archiveName}`);
    const expected = line.split(' ')[0];
    const response = await fetch(`${origin}${archiveName}`);
    if (!response.ok) throw new Error(`Cannot fetch Node runtime: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== expected)
      throw new Error('Node runtime checksum mismatch');
    const archive = join(installation, archiveName);
    await writeFile(archive, bytes);
    if (platform === 'win32') {
      await run(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Expand-Archive -LiteralPath $env:MY_PI_NODE_ARCHIVE -DestinationPath $env:MY_PI_NODE_DESTINATION -Force',
        ],
        {
          env: {
            ...process.env,
            MY_PI_NODE_ARCHIVE: archive,
            MY_PI_NODE_DESTINATION: installation,
          },
        },
      );
    } else {
      await run('tar', ['-xJf', archive, '-C', installation]);
      await chmod(join(installation, name, executablePath), 0o755);
    }
    await rm(archive);
  });
}

if (process.argv.includes('--ensure')) process.stdout.write(`${await ensureNode()}\n`);
