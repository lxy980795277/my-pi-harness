import type { RuntimeConnectionStatus } from '@/features/runtime/types/runtime';
import { CheckCircle2, CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react';
import type { FC } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ConnectionCardProps {
  status: RuntimeConnectionStatus;
  message: string;
  onRetry: () => void;
}

const STATUS_LABELS: Record<ConnectionCardProps['status'], string> = {
  loading: '连接中',
  error: '连接异常',
  ready: '已连接',
};

const STATUS_VARIANTS = {
  loading: 'warning',
  error: 'error',
  ready: 'success',
} as const;

/** Displays health and event readiness without implying an Agent is available. */
export const ConnectionCard: FC<ConnectionCardProps> = ({ status, message, onRetry }) => {
  return (
    <Card aria-labelledby="connection-heading" data-testid="runtime-connection" data-state={status}>
      <CardHeader className="flex items-center justify-between gap-4 border-b border-border">
        <CardTitle id="connection-heading">服务连接</CardTitle>
        <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-4">
        <div className="flex items-start gap-3" aria-live="polite" role="status">
          {status === 'loading' && (
            <LoaderCircle
              width={16}
              height={16}
              strokeWidth={1.5}
              className="mt-1 animate-spin text-warning-solid"
              aria-hidden
            />
          )}
          {status === 'error' && (
            <CircleAlert
              width={16}
              height={16}
              strokeWidth={1.5}
              className="mt-1 text-error-solid"
              aria-hidden
            />
          )}
          {status === 'ready' && (
            <CheckCircle2
              width={16}
              height={16}
              strokeWidth={1.5}
              className="mt-1 text-success-solid"
              aria-hidden
            />
          )}
          <div className="space-y-1">
            <p className="text-[13px] font-medium">{message}</p>
            <p className="text-xs text-muted-foreground">
              界面通过 HTTP 与 SSE 连接当前电脑上的 Runtime 服务。
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={onRetry} disabled={status === 'loading'}>
          <RefreshCw width={12} height={12} strokeWidth={1.5} aria-hidden />
          重新连接
        </Button>
      </CardContent>
    </Card>
  );
};
