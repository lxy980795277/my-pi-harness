import { useCallback, type FC } from 'react';
import { ArrowUpRight, LoaderCircle, LockKeyhole, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { oauthLaunchPresentation } from '@/features/connections/utils/oauth-launch';

/** Inert authorization waiting page; the original authenticated window owns all network operations. */
export const ConnectionOAuthLaunch: FC = () => {
  const state = oauthLaunchPresentation(window.location.search);
  const close = useCallback((): void => {
    window.close();
  }, []);
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6 text-foreground">
      <section
        aria-labelledby="connection-oauth-title"
        className="w-full max-w-lg rounded-3xl border border-border bg-card px-8 py-10 text-center text-card-foreground shadow-sm"
      >
        <div className="mb-6 flex justify-center text-primary">
          {state.valid && (
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-secondary">
              <LoaderCircle
                width={56}
                height={56}
                aria-hidden
                className="absolute motion-safe:animate-spin"
              />
              <ArrowUpRight width={22} height={22} aria-hidden />
            </div>
          )}
          {!state.valid && <TriangleAlert width={48} height={48} aria-hidden />}
        </div>
        <h1 id="connection-oauth-title" className="text-2xl font-semibold">
          {state.title}
        </h1>
        <p role="status" className="mt-3 text-sm leading-6 text-muted-foreground">
          {state.description}
        </p>
        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <LockKeyhole width={14} height={14} aria-hidden />
          授权凭据仅保存在本机服务
        </p>
        <Button variant="ghost" className="mt-6 rounded-full" onClick={close}>
          关闭窗口
        </Button>
      </section>
    </main>
  );
};
