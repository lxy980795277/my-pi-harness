import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/app';
import { AppProviders } from '@/app/providers';
import { initializeStyleNonce } from '@/utils/style-nonce';

import '@/styles/index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('The renderer root element is missing.');
}

initializeStyleNonce();

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
