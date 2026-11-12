/** Direct writes replace draft review; existing independent memories and source suppressions remain. */
export const DIRECT_MEMORY_WRITES_SQL = `
DROP TABLE memory_proposal_receipts;
DROP TABLE memory_proposals;
UPDATE memory_settings SET data=json_object(
  'allowUse',json(CASE json_type(data,'$.allowUse') WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE 'invalid' END),
  'allowLearning',json('true'),
  'revision',revision
);
UPDATE memory_write_receipts SET data=json_object(
  'allowUse',json(CASE json_type(data,'$.allowUse') WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE 'invalid' END),
  'allowLearning',json('true'),
  'revision',json_extract(data,'$.revision')
) WHERE operation='settings';
`;
