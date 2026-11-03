/** Serialize JSON-compatible tool identities with ordered object members and unchanged arrays. */
export function canonicalToolJson(value: unknown): string {
  return JSON.stringify(value, (_key: string, entry: unknown): unknown => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const entries: [string, unknown][] = Object.entries(entry);
    entries.sort(([left], [right]) => {
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    });
    return Object.fromEntries(entries);
  });
}
