import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isSkillOAuthPage,
  parseSkillOAuthPage,
  skillOAuthLaunchUrl,
  skillOAuthPresentation,
  takeSkillOAuthLaunchTicket,
} from '@/features/plugins/utils/skill-oauth';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('plugin OAuth isolated documents', () => {
  it('recognizes launch and callback routes without mounting the normal application', () => {
    expect(isSkillOAuthPage('/skill-oauth/github/launch')).toBe(true);
    expect(isSkillOAuthPage('/skill-oauth/result')).toBe(true);
    expect(isSkillOAuthPage('/')).toBe(false);
    expect(skillOAuthLaunchUrl('github', 'GitHub & Code')).toBe(
      '/skill-oauth/github/launch?name=GitHub%20%26%20Code',
    );
    expect(parseSkillOAuthPage('/skill-oauth/github/launch', '?name=GitHub')).toEqual({
      type: 'launch',
      target: 'plugin',
      id: 'github',
      name: 'GitHub',
    });
    expect(parseSkillOAuthPage('/skill-oauth/%2e%2e/launch', '')).toEqual({ type: 'invalid' });
  });

  it('renders provider callback outcome independently of the application login', () => {
    const success = parseSkillOAuthPage('/skill-oauth/result', '?name=GitHub&status=success');
    expect(skillOAuthPresentation(success, null)).toMatchObject({
      title: 'GitHub 已连接',
      pending: false,
      successful: true,
    });
    const failure = parseSkillOAuthPage(
      '/skill-oauth/result',
      '?name=GitHub&status=error&message=Denied',
    );
    expect(skillOAuthPresentation(failure, null)).toMatchObject({
      title: 'GitHub 连接失败',
      description: 'Denied',
      successful: false,
    });
  });

  it('strips a valid one-use desktop capability synchronously before it can become a referrer', () => {
    const ticket = 'a'.repeat(43);
    const replaceState = vi.fn();
    vi.stubGlobal('window', {
      location: {
        pathname: '/skill-oauth/github/launch',
        search: '?name=GitHub',
        hash: `#ticket=${ticket}`,
      },
      history: { replaceState },
    });
    expect(takeSkillOAuthLaunchTicket()).toBe(ticket);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/skill-oauth/github/launch?name=GitHub');
  });

  it('also strips invalid or repeated capabilities and rejects them without attempting OAuth', () => {
    for (const hash of ['#ticket=invalid', `#ticket=${'a'.repeat(43)}&ticket=${'b'.repeat(43)}`]) {
      const replaceState = vi.fn();
      vi.stubGlobal('window', {
        location: { pathname: '/skill-oauth/github/launch', search: '', hash },
        history: { replaceState },
      });
      expect(takeSkillOAuthLaunchTicket).toThrow('授权入口已失效');
      expect(replaceState).toHaveBeenCalledOnce();
    }
  });
});
