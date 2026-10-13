import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/app/index.js';
import { AppProviders } from '@/app/providers/index.js';

import '@/styles/index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('The renderer root element is missing.');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
