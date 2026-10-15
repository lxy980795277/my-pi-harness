import { randomBytes } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/** Allows the React refresh preamble and Vite's nonce-bearing CSS only in development. */
const developmentCsp = (nonce: string): Plugin => {
  return {
    name: 'my-pi-harness:development-csp',
    apply: 'serve',
    transformIndexHtml: {
      order: 'post',
      handler: (html): string => {
        const policy =
          /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/.exec(html);

        if (!policy?.[0]) {
          throw new Error('The renderer HTML must declare its Content Security Policy.');
        }

        const developmentPolicy = policy[0]
          .replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`)
          .replace("style-src 'self'", `style-src 'self' 'nonce-${nonce}'`)
          .replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:5174");

        return html.replace(policy[0], '').replace('<head>', `<head>\n    ${developmentPolicy}`);
      },
    },
  };
};

/** Builds the same browser application used by the Electron renderer. */
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const daemonOrigin = env['DAEMON_ORIGIN'] ?? 'http://127.0.0.1:4311';
  const nonce = randomBytes(32).toString('base64');
  const development = command === 'serve';

  return {
    plugins: [react(), tailwindcss(), developmentCsp(nonce)],
    html: development ? { cspNonce: nonce } : {},
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@my-pi-harness/protocol': fileURLToPath(
          new URL('../../packages/protocol/src/index.ts', import.meta.url),
        ),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: true,
      proxy: {
        '/api': {
          target: daemonOrigin,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: true,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: (id): string | undefined => {
            if (/\/node_modules\/(?:react|react-dom|scheduler)\//.test(id)) {
              return 'react-vendor';
            }
            return undefined;
          },
        },
      },
    },
  };
});
