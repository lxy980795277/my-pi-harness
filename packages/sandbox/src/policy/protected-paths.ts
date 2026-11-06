/** A sensitive basename and whether shell reads must also be denied. */
interface ProtectedName {
  name: string;
  processRead: boolean;
  prefix?: boolean;
}

const PROTECTED_NAMES: readonly ProtectedName[] = [
  { name: '.ssh', processRead: true },
  { name: '.aws', processRead: true },
  { name: '.gnupg', processRead: true },
  { name: '.kube', processRead: true },
  { name: '.npmrc', processRead: true },
  { name: '.netrc', processRead: true },
  { name: '.git-credentials', processRead: true },
  { name: '.git', processRead: false },
  { name: '.my-pi-harness', processRead: true },
  { name: '.env', processRead: true, prefix: true },
];

/** File APIs reject these basenames regardless of the host filesystem's case policy. */
export function isSensitiveName(name: string): boolean {
  const lower = name.toLowerCase();
  return PROTECTED_NAMES.some((entry) =>
    entry.prefix === true ? lower.startsWith(entry.name) : lower === entry.name,
  );
}

/** Seatbelt regex generated from the same basenames as the host file guard. */
export function protectedPathExpression(operation: 'read' | 'write'): string {
  const names = PROTECTED_NAMES.filter((entry) => operation === 'write' || entry.processRead);
  const alternatives = names.map((entry) => {
    const literal = entry.name.replace(/[a-z]|[^a-z0-9-]/g, (character) => {
      if (/[a-z]/.test(character)) return `[${character}${character.toUpperCase()}]`;
      return `\\${character}`;
    });
    return literal + (entry.prefix === true ? '[^/]*' : '');
  });
  return `/(${alternatives.join('|')})(/|$)`;
}
