/** Build the common macOS process isolation profile used by Shell, MCP and Office. */
export function sandboxProfile(
  root: string,
  temporary: string,
  runtimeDirectory: string,
  privateDirectory: string,
): string {
  const subpath = (path: string): string => `(subpath ${JSON.stringify(path)})`;
  const reads = [
    '/System',
    '/usr',
    '/bin',
    '/sbin',
    '/Library/Apple',
    '/opt/homebrew',
    '/private/var/db/dyld',
    root,
    temporary,
    runtimeDirectory,
  ];
  return `(version 1)
(deny default)
(allow process-fork)
(allow process-exec)
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read* ${reads.map(subpath).join(' ')} (literal "/") (literal "/dev/null") (literal "/dev/random") (literal "/dev/urandom") (literal "/etc/localtime") (literal "/etc/passwd"))
(allow file-write* ${subpath(root)} ${subpath(temporary)} (literal "/dev/null") (subpath "/dev/fd"))
(deny file-read* ${subpath(privateDirectory)})
(deny file-write* ${subpath(privateDirectory)})
(deny file-read* (regex #"/(\\.ssh|\\.aws|\\.gnupg|\\.kube|\\.npmrc|\\.netrc|\\.git-credentials|\\.env[^/]*|\\.[mM][yY]-[pP][iI]-[hH][aA][rR][nN][eE][sS][sS])(/|$)"))
(deny file-write* (regex #"/(\\.ssh|\\.aws|\\.gnupg|\\.kube|\\.npmrc|\\.netrc|\\.git-credentials|\\.env[^/]*|\\.git|\\.[mM][yY]-[pP][iI]-[hH][aA][rR][nN][eE][sS][sS])(/|$)"))
`;
}
