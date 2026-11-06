import { fileURLToPath } from 'node:url';

/** Fixed, read-only Python helpers shared by PDF viewing and host-registered Skill resources. */
export const DOCUMENT_VIEW_RESOURCE_DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
