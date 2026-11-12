/** Existing confirmed entries retain fixed adoption; historical prompt blocks remain unchanged. */
export const MEMORY_RELEVANCE_SQL = `
UPDATE memory_entries SET data=json_set(data,'$.mode','fixed') WHERE json_type(data,'$.mode') IS NULL;
ALTER TABLE memory_adoptions ADD COLUMN selection TEXT CHECK (selection IS NULL OR json_valid(selection));
`;
