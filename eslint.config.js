import { fileURLToPath } from 'node:url';
import { createConfig } from '@my-pi-harness/eslint-config';

export default createConfig(fileURLToPath(new URL('.', import.meta.url)));
