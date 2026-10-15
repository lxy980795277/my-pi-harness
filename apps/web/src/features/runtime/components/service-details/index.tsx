import type { HealthResponse } from '@my-pi-harness/protocol';
import type { FC } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ServiceDetailsProps {
  health: HealthResponse | undefined;
}

const formatTimestamp = (timestamp: number): string => {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'medium',
    hour12: false,
  }).format(timestamp);
};

/** Displays metadata supplied by the daemon, only after successful validation. */
export const ServiceDetails: FC<ServiceDetailsProps> = ({ health }) => {
  return (
    <Card aria-labelledby="service-heading" data-testid="service-details">
      <CardHeader className="border-b border-border">
        <CardTitle id="service-heading">服务信息</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        {!health && (
          <p className="py-4 text-xs text-muted-foreground">连接成功后显示当前服务信息。</p>
        )}
        {health && (
          <dl className="grid grid-cols-[88px_minmax(0,1fr)] items-baseline gap-x-4 gap-y-4 text-xs">
            <dt className="text-muted-foreground">应用版本</dt>
            <dd className="font-mono">{health.appVersion}</dd>
            <dt className="text-muted-foreground">协议版本</dt>
            <dd className="font-mono">v{health.protocolVersion}</dd>
            <dt className="text-muted-foreground">Node.js</dt>
            <dd className="font-mono">{health.nodeVersion}</dd>
            <dt className="text-muted-foreground">启动时间</dt>
            <dd className="tabular-nums">{formatTimestamp(health.startedAt)}</dd>
            <dt className="text-muted-foreground">服务实例</dt>
            <dd className="font-mono text-[11px] break-all">{health.instanceId}</dd>
          </dl>
        )}
      </CardContent>
    </Card>
  );
};
