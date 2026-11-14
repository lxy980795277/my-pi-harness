import { Archive, Download, Upload } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { ArchiveJobStatus } from '@/features/archives/components/archive-job-status';
import { ArchivePreview } from '@/features/archives/components/archive-preview';
import type { useArchiveTransfer } from '@/features/archives/hooks/use-archive-transfer';
import { describeError } from '@/utils/describe-error';

interface ArchiveTransferProps {
  mode: 'import' | 'export' | 'history';
  state: ReturnType<typeof useArchiveTransfer>;
}

/** Upload, preflight and explicit publication remain separate actions with separate observed states. */
export const ArchiveTransfer: FC<ArchiveTransferProps> = ({ mode, state }) => {
  const job = state.query.data;
  return (
    <div className="space-y-5">
      <Notice>
        完整归档包含私有对话、工具正文及引用资源，请妥善保管。模型 Key、OAuth Token
        和本机授权不会包含在归档中；正文原本填写的秘密不会自动脱敏。
      </Notice>
      {state.error !== null && <Notice tone="error">{state.error}</Notice>}
      {state.query.isError && !state.missing && (
        <Notice tone="error">{describeError(state.query.error)}</Notice>
      )}
      {state.missing && (
        <Notice>
          暂未确认此操作是否已接收，或临时任务已随服务重启清理。不会自动重新提交；已发布导入的结果可从操作历史找回。
        </Notice>
      )}
      {state.operationId !== null && state.query.isPending && (
        <p className="text-sm text-muted-foreground" role="status">
          正在读取归档操作…
        </p>
      )}
      {state.operationId !== null && job === undefined && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] break-all text-muted-foreground">
            {state.operationId}
          </span>
          <Button type="button" variant="outline" className="h-7 text-xs" onClick={state.refresh}>
            查询结果
          </Button>
        </div>
      )}
      {mode === 'export' && job === undefined && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            导出冻结的全部分支、子任务以及可达附件、产物、文件前后像和 Skill 资源。单独 JSONL
            日志不包含这些资源。
          </p>
          <Button type="button" onClick={state.exportArchive} disabled={state.pending}>
            <Archive width={15} height={15} aria-hidden />
            {state.operationId === null && '生成完整归档'}
            {state.operationId !== null && '使用原 ID 重试导出'}
          </Button>
        </div>
      )}
      {mode === 'import' && job === undefined && (
        <section className="space-y-3" aria-label="选择完整归档文件">
          <Input
            ref={state.input}
            type="file"
            accept=".tar.gz,.tgz,application/gzip"
            className="hidden"
            onChange={state.changeFile}
            aria-label="选择归档文件"
            disabled={state.pending}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={state.choose} disabled={state.pending}>
              <Upload width={15} height={15} aria-hidden />
              选择归档文件
            </Button>
            <p className="min-w-0 text-xs break-all text-muted-foreground">
              {state.fileName ?? 'tar.gz 或 tgz · 压缩后最多 256 MiB'}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            上传只做完整预检，不会立即导入会话或执行历史操作。
          </p>
          <Button
            type="button"
            onClick={state.upload}
            disabled={state.pending || state.fileName === null}
          >
            上传并预检
          </Button>
        </section>
      )}
      {job !== undefined && (
        <ArchiveJobStatus
          job={job}
          pending={state.pending}
          onCancel={state.cancel}
          onRefresh={state.refresh}
        />
      )}
      {job?.kind === 'import' && job.preview !== null && <ArchivePreview preview={job.preview} />}
      {state.commitUnconfirmed && job?.status === 'ready' && (
        <Notice>
          发布请求尚待确认，正在按原 ID 查询。重新确认只会使用同一个操作 ID 和同一份归档摘要。
        </Notice>
      )}
      {job?.kind === 'import' && job.status === 'ready' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            导入后先以只读历史展示。新执行需要另行选择当前模型、工作区，并重新采用本机权限。
          </p>
          <Button
            type="button"
            onClick={state.commit}
            disabled={state.pending || job.preview?.canImport !== true}
          >
            {!state.commitUnconfirmed && '确认导入只读会话'}
            {state.commitUnconfirmed && '使用原 ID 再次确认导入'}
          </Button>
        </div>
      )}
      {job?.kind === 'export' && (job.status === 'ready' || job.status === 'completed') && (
        <div className="space-y-3">
          {job.downloadAvailable && (
            <Button type="button" onClick={state.download} disabled={state.downloading}>
              <Download width={15} height={15} aria-hidden />
              下载完整归档
            </Button>
          )}
          {!job.downloadAvailable && <Notice>临时文件已释放，请重新导出。</Notice>}
        </div>
      )}
      {job?.kind === 'import' && job.status === 'completed' && (
        <div className="space-y-3">
          <Notice tone="success">会话已导入，历史审批、队列和外部授权不会恢复。</Notice>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={state.readSession}>
              阅读只读会话
            </Button>
            <Button type="button" onClick={state.bindSession}>
              配置当前依赖并继续
            </Button>
          </div>
        </div>
      )}
      {mode !== 'history' &&
        job !== undefined &&
        job.status !== 'running' &&
        job.status !== 'publishing' && (
          <Button type="button" variant="ghost" onClick={state.startNew} disabled={state.pending}>
            新建归档操作
          </Button>
        )}
    </div>
  );
};
