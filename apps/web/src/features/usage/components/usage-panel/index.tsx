import type { UsageQuery } from '@my-pi-harness/protocol';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Switch } from '@/components/ui/switch';
import { useUsagePanel } from '@/features/usage/hooks/use-usage-panel';
import { describeError } from '@/utils/describe-error';

interface UsagePanelProps {
  sessionId: string;
  scope: UsageQuery;
  running?: boolean;
  compact?: boolean;
  title?: string;
}

/** Public cross-feature usage panel for the selected execution scope. */
export const UsagePanel: FC<UsagePanelProps> = ({
  sessionId,
  scope,
  running = false,
  compact = false,
  title = '用量统计',
}) => {
  const state = useUsagePanel(sessionId, scope, running, compact);
  return (
    <section
      className="space-y-4 rounded-2xl border border-border bg-card p-4 text-card-foreground"
      aria-label={title}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="flex items-center gap-3">
          {state.showScopeControl && (
            <div className="flex items-center gap-2">
              <Label htmlFor={state.toggleId} className="text-xs font-normal text-muted-foreground">
                包含子任务
              </Label>
              <Switch
                id={state.toggleId}
                checked={state.includeDescendants}
                onCheckedChange={state.setIncludeDescendants}
              />
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            aria-expanded={state.showDetails}
            onClick={state.toggleDetails}
          >
            {state.showDetails && <ChevronDown width={13} height={13} aria-hidden />}
            {!state.showDetails && <ChevronRight width={13} height={13} aria-hidden />}
            {state.detailLabel}
          </Button>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <span title={state.text.tokensTitle}>{state.text.tokensLabel}</span>
        <span title={state.text.durationTitle}>{state.text.durationLabel}</span>
        <span title={state.text.costTitle}>{state.text.costLabel}</span>
      </div>
      <p className="text-[11px] text-muted-foreground">{state.text.coverageLabel}</p>
      <p className="text-[11px] text-muted-foreground">统计范围内的全部已提交请求</p>
      {state.query.isError && (
        <div className="space-y-2">
          <Notice tone="error">{describeError(state.query.error)}</Notice>
          <Button
            type="button"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={state.retry}
          >
            重新读取统计
          </Button>
        </div>
      )}
      {state.showDetails && state.query.data && (
        <div className="space-y-5 border-t border-border pt-4">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-xs">
            {state.facts.map((fact) => {
              return (
                <div key={fact.label} className="contents">
                  <dt className="text-muted-foreground">{fact.label}</dt>
                  <dd className="min-w-0 break-words">{fact.value}</dd>
                </div>
              );
            })}
          </dl>
          {state.purposes.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <caption className="pb-3 text-left font-medium">模型调用拆分</caption>
                <thead className="border-b border-border text-muted-foreground">
                  <tr>
                    <th className="pb-2 font-normal">用途</th>
                    <th className="pb-2 font-normal">已记录 / 调用</th>
                    <th className="pb-2 font-normal">Token</th>
                    <th className="pb-2 font-normal">累计模型耗时</th>
                    <th className="pb-2 font-normal">USD估算</th>
                  </tr>
                </thead>
                <tbody>
                  {state.purposes.map((row) => {
                    return (
                      <tr key={row.purpose}>
                        <td className="py-2 pr-4">{row.purpose}</td>
                        <td className="py-2 pr-4">{row.calls}</td>
                        <td className="py-2 pr-4">{row.tokens}</td>
                        <td className="py-2 pr-4">{row.duration}</td>
                        <td className="py-2">{row.cost}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {(state.externalServices.length > 0 || state.externalOmittedLabel !== null) && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium">外部服务</h4>
              {state.externalServices.map((service) => {
                return (
                  <p key={service.service} className="text-xs text-muted-foreground">
                    {service.service} · 工具调用 {service.calls} 次 · 费用未知
                  </p>
                );
              })}
              {state.externalOmittedLabel && (
                <p className="text-xs text-muted-foreground">{state.externalOmittedLabel}</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                调用次数为本机工具观察，未计入模型估算，不代表服务端请求数或账单。
              </p>
            </div>
          )}
          <p className="text-[11px] leading-5 text-muted-foreground">
            模型、工具和排队耗时分别累计，并行区间可以重叠。费用按请求保存的目录价格估算，缺少用量或价格的请求保留未知状态。
          </p>
        </div>
      )}
    </section>
  );
};
