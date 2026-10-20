import {
  AuthStatusSchema,
  SessionSnapshotSchema,
  type SessionSnapshot,
} from '@my-pi-harness/protocol';
import type { Page } from '@playwright/test';
import { Value } from 'typebox/value';

const sessionHeaders = async (page: Page): Promise<Record<string, string>> => {
  const origin = new URL(page.url()).origin;
  const response = await page.request.get(`${origin}/api/auth/status`);
  const status: unknown = await response.json();
  if (!response.ok() || !Value.Check(AuthStatusSchema, status) || status.csrfToken === null) {
    throw new Error('The session fixture requires authenticated access');
  }
  return { Origin: origin, 'X-CSRF-Token': status.csrfToken };
};

/** Selects a persisted branch through the public API independently of removed header controls. */
export const selectTestSessionBranch = async (
  page: Page,
  sessionId: string,
  branchId: string,
): Promise<SessionSnapshot> => {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post(
    `${origin}/api/sessions/${encodeURIComponent(sessionId)}/branches/${encodeURIComponent(branchId)}/select`,
    { headers: await sessionHeaders(page), data: {} },
  );
  const snapshot: unknown = await response.json();
  if (
    !response.ok() ||
    !Value.Check(SessionSnapshotSchema, snapshot) ||
    snapshot.session.id !== sessionId ||
    snapshot.session.activeBranchId !== branchId
  ) {
    throw new Error('Selecting the fixture session branch failed');
  }
  return snapshot;
};

/** Archives a test-owned session through the supported authenticated API. */
export const archiveTestSession = async (page: Page, sessionId: string): Promise<void> => {
  const origin = new URL(page.url()).origin;
  const response = await page.request.delete(
    `${origin}/api/sessions/${encodeURIComponent(sessionId)}`,
    { headers: await sessionHeaders(page), data: {} },
  );
  if (!response.ok()) {
    throw new Error(`Archiving the fixture session failed (${response.status()})`);
  }
};
