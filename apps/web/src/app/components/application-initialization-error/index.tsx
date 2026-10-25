import type { FC } from 'react';
import type { ApplicationPreparationStage } from '@/app/types/initialization';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { ConnectionCard } from '@/features/runtime/components/connection-card';
import type { Action } from '@/types/events';

interface ApplicationInitializationErrorProps {
  stage: ApplicationPreparationStage;
  message: string;
  onRetry: Action;
}

/** Startup failures expose recovery without mounting partially initialized workspace surfaces. */
export const ApplicationInitializationError: FC<ApplicationInitializationErrorProps> = ({
  stage,
  message,
  onRetry,
}) => {
  if (stage === 'service') {
    return (
      <div
        className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground"
        data-testid="service-gate"
      >
        <div className="w-full max-w-lg">
          <ConnectionCard status="error" message={message} onRetry={onRetry} />
        </div>
      </div>
    );
  }
  return (
    <div
      className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground"
      data-testid="application-initialization-error"
    >
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-base font-medium">暂时无法进入工作台</h1>
        <Notice tone="error">{message}</Notice>
        <Button type="button" variant="outline" onClick={onRetry}>
          重试
        </Button>
      </div>
    </div>
  );
};
