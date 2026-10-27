import { createHash, randomBytes } from 'node:crypto';
import { SkillError } from '@my-pi-harness/integrations';
import type { SkillOAuthLaunchTicket } from '@my-pi-harness/protocol';

export type LaunchTarget = 'plugin' | 'mcp';
interface Ticket {
  target: LaunchTarget;
  id: string;
  snapshot: string;
  expiresAt: number;
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
    if (this.closed) throw new SkillError('OAUTH_LAUNCH_CLOSED', '授权服务正在关闭。');
    for (const [key, ticket] of this.tickets)
      if (ticket.expiresAt <= Date.now()) this.tickets.delete(key);
    if (this.tickets.size >= 100)
      throw new SkillError('OAUTH_LAUNCH_BUSY', '待完成的授权过多，请稍后重试。');
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
    if (this.closed) throw new SkillError('OAUTH_LAUNCH_CLOSED', '授权服务正在关闭。');
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
      throw new SkillError('OAUTH_LAUNCH_EXPIRED', '授权启动链接已失效，请返回应用重新授权。');
  }
  public close(): void {
    this.closed = true;
    this.tickets.clear();
  }
}
