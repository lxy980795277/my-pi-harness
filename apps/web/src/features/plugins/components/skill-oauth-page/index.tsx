import type { FC } from 'react';
import { CircleCheck, CircleX, LoaderCircle, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSkillOAuthPage } from '@/features/plugins/hooks/use-skill-oauth-page';
import type { SkillOAuthPage as SkillOAuthPageState } from '@/features/plugins/types/skill-oauth';

interface SkillOAuthPageProps {
  page: SkillOAuthPageState;
  ticket: string | null;
}

/** Isolated OAuth launch and callback surfaces keep the application shell in its original window. */
export const SkillOAuthPage: FC<SkillOAuthPageProps> = ({ page, ticket }) => {
  const { presentation, close } = useSkillOAuthPage(page, ticket);
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6 text-foreground">
      <section
        aria-labelledby="skill-oauth-title"
        className="w-full max-w-lg rounded-3xl border border-border bg-card px-8 py-10 text-center text-card-foreground shadow-sm"
      >
        <div className="mb-6 flex justify-center text-primary">
          {presentation.pending && (
            <LoaderCircle width={48} height={48} aria-hidden className="motion-safe:animate-spin" />
          )}
          {presentation.successful && <CircleCheck width={48} height={48} aria-hidden />}
          {!presentation.pending && !presentation.successful && (
            <CircleX width={48} height={48} aria-hidden className="text-destructive" />
          )}
        </div>
        <h1 id="skill-oauth-title" className="text-2xl font-semibold">
          {presentation.title}
        </h1>
        <p role="status" className="mt-3 text-sm leading-6 text-muted-foreground">
          {presentation.description}
        </p>
        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <LockKeyhole width={14} height={14} aria-hidden />
          授权凭据仅保存在本机服务
        </p>
        {!presentation.pending && (
          <Button className="mt-6 rounded-full" onClick={close}>
            关闭窗口
          </Button>
        )}
      </section>
    </main>
  );
};
