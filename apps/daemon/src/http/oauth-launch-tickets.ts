import { createHash, randomBytes } from 'node:crypto';
import type { SkillOAuthLaunchTicket } from '@my-pi-harness/protocol';

type LaunchTarget = 'plugin' | 'mcp';
type OAuthLaunchErrorCode = 'OAUTH_LAUNCH_CLOSED' | 'OAUTH_LAUNCH_BUSY' | 'OAUTH_LAUNCH_EXPIRED';

interface Ticket {
  target: LaunchTarget;
  id: string;
  snapshot: string;
  expiresAt: number;
}

const messages: Record<OAuthLaunchErrorCode, string> = {
  OAUTH_LAUNCH_CLOSED: '授权服务正在关闭。',
  OAUTH_LAUNCH_BUSY: '待完成的授权过多，请稍后重试。',
  OAUTH_LAUNCH_EXPIRED: '授权启动链接已失效，请返回应用重新授权。',
};

/** Fixed public failures from the shared browser-launch capability, independent of either target. */
export class OAuthLaunchError extends Error {
  public readonly status: 400 | 409;
  public constructor(public readonly code: OAuthLaunchErrorCode) {
    super(messages[code]);
    this.name = 'OAuthLaunchError';
    this.status = code === 'OAUTH_LAUNCH_EXPIRED' ? 400 : 409;
  }
}

/** System-browser launch capabilities never contain or establish an application login session. */
export class OAuthLaunchTickets {
  private readonly tickets = new Map<string, Ticket>();
  private closed = false;
  public constructor(private readonly snapshot: (target: LaunchTarget, id: string) => string) {}
  private key(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
  public create(
    target: LaunchTarget,
    id: string,
    origin: string,
    name: string,
  ): SkillOAuthLaunchTicket {
    if (this.closed) throw new OAuthLaunchError('OAUTH_LAUNCH_CLOSED');
    for (const [key, ticket] of this.tickets)
      if (ticket.expiresAt <= Date.now()) this.tickets.delete(key);
    if (this.tickets.size >= 100) throw new OAuthLaunchError('OAUTH_LAUNCH_BUSY');
    const value = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + 10 * 60_000;
    this.tickets.set(this.key(value), {
      target,
      id,
      snapshot: this.snapshot(target, id),
      expiresAt,
    });
    const url = new URL(
      `/${target === 'plugin' ? 'skill' : 'mcp'}-oauth/${encodeURIComponent(id)}/launch`,
      origin,
    );
    url.searchParams.set('name', name);
    url.hash = new URLSearchParams({ ticket: value }).toString();
    return { launchUrl: url.href, expiresAt };
  }
  public consume(target: LaunchTarget, id: string, value: string): void {
    if (this.closed) throw new OAuthLaunchError('OAUTH_LAUNCH_CLOSED');
    const key = this.key(value);
    const ticket = this.tickets.get(key);
    this.tickets.delete(key);
    if (
      ticket === undefined ||
      ticket.target !== target ||
      ticket.id !== id ||
      ticket.expiresAt <= Date.now() ||
      ticket.snapshot !== this.snapshot(target, id)
    )
      throw new OAuthLaunchError('OAUTH_LAUNCH_EXPIRED');
  }
  public close(): void {
    this.closed = true;
    this.tickets.clear();
  }
}
