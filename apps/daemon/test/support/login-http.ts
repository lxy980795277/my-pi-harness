import { AuthStatusSchema, LoginFlowSchema } from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import type { FixtureAuthorization } from './login.js';

/** Complete Device Flow against a daemon whose upstream GitHub adapter is test-injected. */
export async function loginThroughHttp(
  origin: string,
  trusted: FixtureAuthorization,
): Promise<FixtureAuthorization> {
  const headers = {
    Cookie: trusted.cookie,
    Origin: origin,
    'X-CSRF-Token': trusted.csrf,
    'Content-Type': 'application/json',
  };
  const response = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ providerId: 'github' }),
    signal: AbortSignal.timeout(5000),
  });
  const body: unknown = await response.json();
  if (!response.ok || !Value.Check(LoginFlowSchema, body))
    throw new Error('Built fixture GitHub challenge failed');
  let current = body;
  const deadline = Date.now() + 10_000;
  while (current.status === 'pending' && Date.now() < deadline) {
    const polled = await fetch(`${origin}/api/auth/login-flows/${body.id}`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    const flow: unknown = await polled.json();
    if (!polled.ok || !Value.Check(LoginFlowSchema, flow))
      throw new Error('Built fixture GitHub challenge could not be read');
    current = flow;
    if (current.status === 'pending') await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (current.status !== 'completed')
    throw new Error(`Built fixture login did not complete: ${current.status}`);
  const completed = await fetch(`${origin}/api/auth/login-flows/${body.id}/complete`, {
    method: 'POST',
    headers,
    body: '{}',
    signal: AbortSignal.timeout(5000),
  });
  const status: unknown = await completed.json();
  const loginCookie = completed.headers.get('set-cookie')?.split(';')[0];
  if (
    !completed.ok ||
    !Value.Check(AuthStatusSchema, status) ||
    !status.authenticated ||
    !loginCookie?.startsWith('my_pi_session=')
  )
    throw new Error('Built fixture application session was not issued');
  return { cookie: `${trusted.cookie}; ${loginCookie}`, csrf: trusted.csrf };
}
