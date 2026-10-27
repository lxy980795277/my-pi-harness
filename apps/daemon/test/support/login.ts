import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuthStatusSchema } from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import type { ApplicationServices } from '../../src/application/services.js';

/** Cookies and CSRF for a test client; bearer values remain outside application DTOs. */
export interface FixtureAuthorization {
  cookie: string;
  csrf: string;
}

/** Pair through HTTP and require local trust without granting application login. */
export async function pairFixture(origin: string, code: string): Promise<FixtureAuthorization> {
  const response = await fetch(`${origin}/api/auth/pair`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(5000),
  });
  const body: unknown = await response.json();
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (
    !response.ok ||
    !Value.Check(AuthStatusSchema, body) ||
    !body.localAuthorized ||
    body.authenticated ||
    body.user !== null ||
    body.session !== null ||
    body.csrfToken === null ||
    !cookie
  )
    throw new Error('Fixture pairing must grant local trust only');
  return { cookie, csrf: body.csrfToken };
}

/**
 * Seed a verified test identity after real local pairing for unrelated API regressions.
 * Device Flow itself is exercised by dedicated login HTTP and browser cases.
 */
export async function loginFixture(
  origin: string,
  services: ApplicationServices,
  code = services.auth.pairingCode,
): Promise<FixtureAuthorization> {
  const paired = await pairFixture(origin, code);
  const token = paired.cookie.slice(paired.cookie.indexOf('=') + 1);
  const local = services.store.auth.findLocalClient(
    createHash('sha256').update(token).digest('hex'),
    Date.now(),
  );
  if (!local) throw new Error('Fixture local client was not persisted');
  const loginToken = randomBytes(32).toString('base64url');
  const createdAt = Date.now();
  services.store.auth.completeLogin(
    {
      providerId: 'github',
      issuer: 'https://github.com',
      subject: '42424242',
      name: 'Fixture User',
      avatarUrl: null,
    },
    local.id,
    {
      id: randomUUID(),
      tokenHash: createHash('sha256').update(loginToken).digest('hex'),
      createdAt,
      expiresAt: createdAt + 60_000,
    },
  );
  return { cookie: `${paired.cookie}; my_pi_session=${loginToken}`, csrf: paired.csrf };
}
