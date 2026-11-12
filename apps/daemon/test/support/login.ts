import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuthStatusSchema } from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import type { ApplicationServices } from '../../src/application/services';

/** Cookies and CSRF for a test client; bearer values remain outside application DTOs. */
export interface FixtureAuthorization {
  cookie: string;
  csrf: string;
}

/** Initialize a browser client through HTTP without granting application login. */
export async function initializeClientFixture(origin: string): Promise<FixtureAuthorization> {
  const response = await fetch(`${origin}/api/auth/client`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(5000),
  });
  const body: unknown = await response.json();
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (
    !response.ok ||
    !Value.Check(AuthStatusSchema, body) ||
    !body.clientInitialized ||
    body.authenticated ||
    body.user !== null ||
    body.session !== null ||
    body.csrfToken === null ||
    !cookie
  )
    throw new Error('Fixture initialization must not grant application login');
  return { cookie, csrf: body.csrfToken };
}

/**
 * Seed a verified test identity after real client initialization for unrelated API regressions.
 * Device Flow itself is exercised by dedicated login HTTP and browser cases.
 */
export async function loginFixture(
  origin: string,
  services: ApplicationServices,
): Promise<FixtureAuthorization> {
  const client = await initializeClientFixture(origin);
  const token = client.cookie.slice(client.cookie.indexOf('=') + 1);
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
  return { cookie: `${client.cookie}; my_pi_session=${loginToken}`, csrf: client.csrf };
}
