/** Add current settings without rewriting released provider generations or session facts. */
export const MODEL_SETTINGS_SQL = `
CREATE TABLE builtin_provider_slots (
  builtin_id TEXT PRIMARY KEY NOT NULL,
  provider_id TEXT NOT NULL UNIQUE REFERENCES provider_configs(id)
);
INSERT INTO builtin_provider_slots(builtin_id, provider_id)
SELECT builtin_id, id FROM (
  SELECT id, json_extract(data, '$.builtinId') AS builtin_id,
    row_number() OVER (
      PARTITION BY json_extract(data, '$.builtinId')
      ORDER BY json_extract(data, '$.enabled') DESC, id ASC
    ) AS position
  FROM provider_configs
  WHERE json_extract(data, '$.kind') = 'builtin'
    AND json_extract(data, '$.baseUrl') IS NULL
    AND json_array_length(json_extract(data, '$.models')) = 0
) WHERE position = 1;
UPDATE provider_configs SET data = json_set(data,
  '$.requiresApiKey', json('true'),
  '$.legacy', json('false'),
  '$.configured', json('false'),
  '$.authSource', NULL,
  '$.credentialPreview', NULL,
  '$.hasCredential', json('false'),
  '$.credentialType', NULL
);
CREATE TABLE app_settings (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  revision INTEGER NOT NULL,
  data TEXT NOT NULL
);
INSERT INTO app_settings(id, revision, data) VALUES
  (1, 1, '{"revision":1,"defaultModel":null}');
`;
