import { fileURLToPath } from 'node:url';
import { createConfig } from './scripts/eslint/config.js';

export default createConfig(fileURLToPath(new URL('.', import.meta.url)));
