import type { RuntimeReadyEvent } from '@my-pi-harness/protocol';
import { Radio } from 'lucide-react';
import type { FC } from 'react';

import { Badge } from '@/components/ui/badge/index.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card/index.js';

interface RuntimeEventsProps {
  event: RuntimeReadyEvent | undefined;
  status: 'loading' | 'error' | 'ready';
}

const EMPTY_MESSAGES: Record<RuntimeEventsProps['status'], string> = {
  loading: '正在等待经过校验的 runtime.ready 事件。',
  error: '事件连接尚未就绪。重新连接后可查看服务事件。',
  ready: '尚未收到服务事件。',
};

/** Shows the actual readiness event; no simulated task events are rendered. */
export const RuntimeEvents: FC<RuntimeEventsProps> = ({ event, status }) => {
  return (
    <Card aria-labelledby="events-heading" data-testid="runtime-events">
      <CardHeader className="flex items-center justify-between gap-4 border-b border-border">
        <CardTitle id="events-heading">事件通道</CardTitle>
        <span className="font-mono text-[11px] text-muted-foreground">SSE</span>
      </CardHeader>
      <CardContent className="pt-4">
        {!event && <p className="py-4 text-xs text-muted-foreground">{EMPTY_MESSAGES[status]}</p>}
        {event && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Radio
                width={14}
                height={14}
                strokeWidth={1.5}
                className="text-success-solid"
                aria-hidden
              />
              <span className="font-mono text-xs">{event.type}</span>
              <Badge variant="success">已接收</Badge>
            </div>
            <p className="text-xs leading-6 text-muted-foreground">
              协议版本和服务实例已核对。此事件说明本机服务就绪。
            </p>
            <pre
              className="overflow-x-auto rounded border border-border bg-muted p-3 font-mono text-[11px] leading-6 text-muted-foreground"
              aria-label="运行就绪事件内容"
              data-testid="runtime-ready-payload"
            >
              {JSON.stringify(event, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
