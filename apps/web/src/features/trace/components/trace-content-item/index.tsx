import type { RequestContentItem } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { useTraceImage } from '@/features/trace/hooks/use-trace-image';

interface TraceContentItemProps {
  sessionId: string;
  requestId: string | null;
  item: RequestContentItem;
}

/** Audited text remains inert; images use a cookie-authenticated same-origin read after explicit selection. */
export const TraceContentItem: FC<TraceContentItemProps> = ({ sessionId, requestId, item }) => {
  const preview = useTraceImage(sessionId, requestId, item.index, item.images);
  return (
    <article className="min-w-0 space-y-2">
      <h4 className="text-[11px] text-muted-foreground">
        {item.role} · 第 {item.index + 1} 项
        {item.offset > 0 && <span> · 从字符 {item.offset} 继续</span>}
      </h4>
      {item.images > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">含 {item.images} 张图片</p>
          {requestId !== null && (
            <div className="flex flex-wrap gap-1.5">
              {preview.indices.map((index) => {
                return (
                  <Button
                    key={index}
                    type="button"
                    value={index}
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={preview.show}
                  >
                    查看图片 {index + 1}
                  </Button>
                );
              })}
              {preview.hasPrevious && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={preview.previous}
                >
                  前20张
                </Button>
              )}
              {preview.hasNext && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={preview.next}
                >
                  后20张
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {preview.image && (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <Button
            type="button"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={preview.close}
          >
            关闭图片
          </Button>
          {preview.image.failed && <Notice tone="error">图片读取失败，请关闭后重试。</Notice>}
          {!preview.image.failed && (
            <img
              key={preview.image.source}
              src={preview.image.source}
              onError={preview.fail}
              alt="该次模型请求中的图片"
              className="mx-auto max-h-[50svh] max-w-full rounded-lg object-contain"
            />
          )}
        </div>
      )}
      <pre className="max-w-full overflow-x-auto rounded-xl bg-muted/60 p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap">
        {item.text}
      </pre>
      {item.truncated && (
        <p className="text-[11px] text-muted-foreground">当前内容还有后续，请继续读取下一段。</p>
      )}
    </article>
  );
};
