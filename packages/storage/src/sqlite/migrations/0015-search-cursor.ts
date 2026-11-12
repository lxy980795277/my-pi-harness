/** Keep generation-scoped vector pages in chunk identity order without sorting the remaining corpus. */
export const SEARCH_CURSOR_SQL = `
CREATE INDEX search_chunks_generation_cursor ON search_chunks(generation,id);
`;
