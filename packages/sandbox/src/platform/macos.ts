import { protectedPathExpression } from '../policy/protected-paths.js';
import type { ProcessAccess } from '../process/types.js';

/** Paths already resolved and authorized by the process resolver. */
export interface MacOsPolicy {
  workspaceRoot: string;
  programPaths: readonly string[];
  temporaryDirectory: string;
  runtimeDirectories: readonly string[];
  profileDirectory: string;
  readOnlyDirectories: readonly string[];
  access: Exclude<ProcessAccess, 'full-access'>;
}

/** Build a per-process Seatbelt profile; network remains denied by default. */
export function sandboxProfile(policy: MacOsPolicy): string {
  const subpath = (path: string): string => `(subpath ${JSON.stringify(path)})`;
  const reads = [
    '/System',
    '/usr',
    '/bin',
    '/sbin',
    '/Library/Apple',
    '/opt/homebrew',
    '/private/var/db/dyld',
    policy.workspaceRoot,
    policy.temporaryDirectory,
    ...policy.runtimeDirectories,
    ...policy.readOnlyDirectories,
  ];
  const writes = [policy.temporaryDirectory];
  if (policy.access === 'workspace-write') writes.push(policy.workspaceRoot);
  return `(version 1)
(deny default)
(allow process-fork)
(allow process-exec)
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read* ${policy.programPaths.map((path) => `(literal ${JSON.stringify(path)})`).join(' ')} ${reads.map(subpath).join(' ')} (literal "/") (literal "/dev/null") (literal "/dev/random") (literal "/dev/urandom") (literal "/etc/localtime") (literal "/etc/passwd"))
(allow file-write* ${writes.map(subpath).join(' ')} (literal "/dev/null") (subpath "/dev/fd"))
(deny file-read* ${subpath(policy.profileDirectory)})
(deny file-write* ${subpath(policy.profileDirectory)})
${policy.readOnlyDirectories.map((path) => `(deny file-write* ${subpath(path)})`).join('\n')}
(deny file-read* (regex #"${protectedPathExpression('read')}"))
(deny file-write* (regex #"${protectedPathExpression('write')}"))
`;
}
