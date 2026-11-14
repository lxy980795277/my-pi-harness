import type { SessionArchivePreview } from '@my-pi-harness/protocol';
import { CheckCircle2 } from 'lucide-react';
import type { FC } from 'react';
import { Notice } from '@/components/ui/notice';
import { useArchivePreview } from '@/features/archives/hooks/use-archive-preview';
import { archiveBytes } from '@/features/archives/utils/archive-view';

interface ArchivePreviewProps {
  preview: SessionArchivePreview;
}

/** Bounded preflight findings separate resource validity from optional current execution dependencies. */
export const ArchivePreview: FC<ArchivePreviewProps> = ({ preview }) => {
  const state = useArchivePreview(preview);
  return (
    <section className="space-y-4" aria-label="归档导入预检">
      <div className="space-y-2 rounded-xl bg-muted/50 p-4">
        <h3 className="text-sm font-medium">{preview.manifest.title}</h3>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 width={14} height={14} aria-hidden />
          资源校验完成 · {preview.manifest.entryCount.toLocaleString()} 个条目 ·{' '}
          {archiveBytes(preview.manifest.totalBytes)}
        </p>
        <p className="text-xs text-muted-foreground">
          归档版本 {preview.manifest.formatVersion} · 冻结序号 {preview.manifest.snapshotSeq}
        </p>
        {preview.manifest.activeAtSnapshot && (
          <p className="text-xs text-muted-foreground">
            导出时会话仍在运行；导入后保留为中断历史，不恢复当时的执行。
          </p>
        )}
        <p className="font-mono text-[11px] break-all text-muted-foreground">
          SHA-256 · {preview.archiveSha256}
        </p>
      </div>
      {preview.conflictCount > 0 && (
        <Notice tone="error">
          <p>发现 {preview.conflictCount} 个身份冲突，不能覆盖现有会话。</p>
          <div className="max-h-40 overflow-auto pt-2">
            {preview.conflicts.map((conflict) => {
              return (
                <p
                  key={conflict.kind + ':' + conflict.id}
                  className="font-mono text-[11px] break-all"
                >
                  {conflict.kind} · {conflict.id}
                </p>
              );
            })}
            {preview.conflictCount > preview.conflicts.length && (
              <p>另有 {preview.conflictCount - preview.conflicts.length} 项冲突。</p>
            )}
          </div>
        </Notice>
      )}
      {preview.warnings.map((warning) => {
        return <Notice key={warning}>{warning}</Notice>;
      })}
      <details className="rounded-xl border border-border p-4 text-xs">
        <summary className="cursor-pointer font-medium">历史依赖与当前配置</summary>
        <div className="space-y-4 pt-4 text-muted-foreground">
          <p>{state.workspace}</p>
          {state.providers.map((provider) => {
            return (
              <div key={provider.id} className="space-y-1">
                <p className="break-all text-foreground">
                  {provider.id} · {provider.modelCount} 个模型引用
                </p>
                <p>{provider.availability}</p>
                <p className="font-mono text-[11px] break-all">{provider.models}</p>
                {provider.omittedModels > 0 && (
                  <p>另有 {provider.omittedModels} 个历史模型引用。</p>
                )}
              </div>
            );
          })}
          {state.omittedProviders > 0 && (
            <p>
              另有 {state.omittedProviders} 个历史 Provider 引用；继续时仅使用显式选择的当前模型。
            </p>
          )}
          {state.plugins.length > 0 && (
            <div className="space-y-1">
              <p className="text-foreground">历史插件引用</p>
              <p className="break-all">{state.plugins.join(' · ')}</p>
              {state.omittedPlugins > 0 && <p>另有 {state.omittedPlugins} 项。</p>}
            </div>
          )}
          <p>归档不会安装插件或迁移任何授权。缺少当前依赖仍可导入并阅读历史。</p>
        </div>
      </details>
    </section>
  );
};
