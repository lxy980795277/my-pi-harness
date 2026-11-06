import { readFileSync } from 'node:fs';
import {
  parsePluginConnectionManifest,
  type PluginConnectionDefinition,
} from '../src/plugins/connections.js';

/** OAuth protocol fixtures do not load installed or bundled plugin directories. */
export function pluginConnectionDefinition(id: string): PluginConnectionDefinition {
  if (!['github', 'google', 'vercel', 'notion', 'supabase'].includes(id))
    throw new Error('Unknown OAuth fixture');
  return parsePluginConnectionManifest(
    readFileSync(new URL(`./fixtures/plugin-oauth/${id}.yaml`, import.meta.url), 'utf8'),
    id,
  );
}
