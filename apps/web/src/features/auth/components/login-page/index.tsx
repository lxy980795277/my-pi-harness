import type { AuthStatus } from '@my-pi-harness/protocol';
import githubLogo from '@lobehub/icons-static-svg/icons/github.svg';
import { LoaderCircle, ExternalLink } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { useLogin } from '@/features/auth/hooks/use-login';

interface LoginPageProps {
  status: AuthStatus;
  onAuthenticated: (status: AuthStatus) => void;
}

/** A trusted local client still signs in before any private workspace is mounted. */
export const LoginPage: FC<LoginPageProps> = ({ status, onAuthenticated }) => {
  const state = useLogin(status, onAuthenticated);
  return (
    <div
      className="flex min-h-svh w-full items-center justify-center px-6 py-12"
      data-testid="login-page"
    >
      <Card className="w-full max-w-sm space-y-3 rounded-3xl border-border/50 p-4 shadow-sm">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted">
            <img
              src="/favicon.svg"
              width={28}
              height={28}
              alt="My Pi Harness"
              className="dark:invert"
            />
          </div>
          <CardTitle className="text-lg leading-6 font-semibold">登录</CardTitle>
          <div className="text-sm leading-5 text-muted-foreground">使用 GitHub 账号登录进入</div>
        </div>
        {state.configurationMessage && <Notice>{state.configurationMessage}</Notice>}
        {state.showLoginButton && (
          <Button
            type="button"
            variant="outline"
            className="h-9 w-full gap-2 rounded-full bg-card text-sm"
            onClick={state.start}
            disabled={state.pending}
            aria-busy={state.loginButtonBusy}
          >
            <img
              src={githubLogo}
              width={16}
              height={16}
              alt=""
              aria-hidden
              className="dark:invert"
            />
            {state.loginButtonLabel}
          </Button>
        )}
        {state.flow && state.showFlow && (
          <div className="space-y-3">
            {state.flow.deviceCode && (
              <div className="space-y-2">
                <div className="text-center text-xs text-muted-foreground">
                  在 GitHub 输入验证码
                </div>
                <div
                  className="rounded-lg bg-muted px-4 py-3 text-center font-mono text-xl tracking-widest"
                  data-testid="login-device-code"
                >
                  {state.flow.deviceCode}
                </div>
              </div>
            )}
            {state.safeUrl && state.desktop && (
              <Button
                type="button"
                variant="outline"
                className="h-9 w-full rounded-full bg-card text-sm"
                onClick={state.openDesktop}
              >
                <ExternalLink width={14} height={14} aria-hidden />
                打开 GitHub
              </Button>
            )}
            {state.pending && !state.cancelPending && (
              <div
                className="flex items-center justify-center gap-2 text-xs text-muted-foreground"
                role="status"
              >
                <LoaderCircle width={14} height={14} className="animate-spin" aria-hidden />
                等待 GitHub 授权…
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                className="rounded-full"
                onClick={state.cancel}
                disabled={state.cancelPending}
              >
                取消登录
              </Button>
              {state.canComplete && (
                <Button
                  type="button"
                  className="rounded-full"
                  onClick={state.retryCompletion}
                  disabled={state.pending}
                >
                  重试进入
                </Button>
              )}
              {state.canRestart && !state.canComplete && (
                <Button type="button" className="rounded-full" onClick={state.start}>
                  重新登录
                </Button>
              )}
            </div>
          </div>
        )}
        {state.error && <Notice tone="error">{state.error}</Notice>}
      </Card>
    </div>
  );
};
