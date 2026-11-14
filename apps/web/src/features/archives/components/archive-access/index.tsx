import { useCallback, type FC } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { useArchiveStore } from '@/features/archives/stores/archives';

interface ArchiveAccessProps {
  sessionId: string;
}

/** Historical permissions never authorize a new run or revive pending interactions. */
export const ArchiveAccess: FC<ArchiveAccessProps> = ({ sessionId }) => {
  const open = useArchiveStore((state) => {
    return state.openBinding;
  });
  const bind = useCallback((): void => {
    open(sessionId);
  }, [open, sessionId]);
  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-4">
      <Notice>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm">导入的只读会话</p>
            <p className="text-xs text-muted-foreground">
              选择当前模型与工作区后才能继续；历史队列、批准和插件授权不会恢复。
            </p>
          </div>
          <Button type="button" variant="outline" onClick={bind}>
            配置并继续
          </Button>
        </div>
      </Notice>
    </div>
  );
};
