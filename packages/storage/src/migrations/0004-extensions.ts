/** Skill controls and installation ownership survive session projection rebuilds. */
export const EXTENSIONS_SQL = `
CREATE TABLE extension_records (
 kind TEXT NOT NULL CHECK (kind IN ('skill', 'plugin')),
 id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK (revision >= 1),
 data TEXT NOT NULL CHECK (json_valid(data)),
 PRIMARY KEY(kind, id)
);
`;
