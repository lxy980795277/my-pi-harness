/** Backfill active and archived workspace metadata without changing session facts. */
export const WORKSPACE_ICONS_SQL = `
UPDATE workspaces SET data = json_set(data, '$.icon', 'folder')
WHERE json_type(data, '$.icon') IS NULL;
`;
