import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/app';
import { AppProviders } from '@/app/providers';
import { ConnectionOAuthLaunch } from '@/features/connections/components/connection-oauth-launch';
import { isConnectionOAuthLaunch } from '@/features/connections/utils/oauth-launch';
import { SkillOAuthPage } from '@/features/plugins/components/skill-oauth-page';
import {
  isSkillOAuthPage,
  parseSkillOAuthPage,
  takeSkillOAuthLaunchTicket,
} from '@/features/plugins/utils/skill-oauth';
import { initializeStyleNonce } from '@/utils/style-nonce';

import '@/styles/index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('The renderer root element is missing.');
}

initializeStyleNonce();

let surface = <App />;
if (isConnectionOAuthLaunch(window.location.pathname)) surface = <ConnectionOAuthLaunch />;
if (isSkillOAuthPage(window.location.pathname)) {
  let page = parseSkillOAuthPage(window.location.pathname, window.location.search);
  let ticket: string | null = null;
  try {
    ticket = takeSkillOAuthLaunchTicket();
  } catch {
    // Invalid desktop capabilities still leave a scrubbed URL and cannot start authorization.
    page = { type: 'invalid' };
  }
  surface = <SkillOAuthPage page={page} ticket={ticket} />;
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>{surface}</AppProviders>
  </StrictMode>,
);
