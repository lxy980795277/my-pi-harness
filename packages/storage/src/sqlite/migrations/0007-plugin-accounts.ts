/** Retired default accounts become independent accounts; saved credentials and references remain. */
export const PLUGIN_ACCOUNTS_SQL = `
UPDATE external_connections
SET data = json_remove(data, '$.managedPluginId')
WHERE json_type(data, '$.managedPluginId') = 'text';
`;
