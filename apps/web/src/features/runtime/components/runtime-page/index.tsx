import { ArrowRight, Layers3 } from 'lucide-react';
import { memo, type FC } from 'react';

import { Badge } from '@/components/ui/badge/index.js';
import { ConnectionCard } from '@/features/runtime/components/connection-card/index.js';
import { RuntimeEvents } from '@/features/runtime/components/runtime-events/index.js';
import { ServiceDetails } from '@/features/runtime/components/service-details/index.js';
import { useRuntimeConnection } from '@/features/runtime/hooks/use-runtime-connection.js';

/** M0 workspace: verifies the product foundation before Agent features are added. */
export const RuntimePage: FC = memo(() => {
  const connection = useRuntimeConnection();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold tracking-tight">本机运行状态</h1>
          <p className="text-xs text-muted-foreground">查看服务连接、运行环境与事件通道。</p>
        </div>
        <Badge>M0 · 工程底座</Badge>
      </header>

      <ConnectionCard
        status={connection.status}
        message={connection.message}
        onRetry={connection.retry}
      />

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <ServiceDetails health={connection.health} />
        <RuntimeEvents event={connection.event} status={connection.status} />
      </div>

      <section
        className="flex items-start gap-3 rounded-lg border border-dashed border-border p-4"
        aria-labelledby="foundation-heading"
      >
        <Layers3
          width={16}
          height={16}
          strokeWidth={1.5}
          className="mt-1 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div className="space-y-2">
          <h2 id="foundation-heading" className="text-xs font-medium">
            当前完成工程连接
          </h2>
          <p className="text-xs leading-6 text-muted-foreground">
            浏览器与桌面应用共用此界面。Agent 对话、模型配置和工具执行将在后续里程碑实现。
          </p>
          <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <ArrowRight width={12} height={12} strokeWidth={1.5} aria-hidden />
            下一步：接入 Pi 内核与单 Agent 运行
          </p>
        </div>
      </section>
    </div>
  );
});
