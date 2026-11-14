import type { FC } from 'react';
import { useRenderDiagnostic } from '@/hooks/use-render-diagnostic';
import { traceDuration } from '@/features/trace/utils/trace-view';

interface RenderDiagnosticProps {
  sessionId: string;
}

/** Local render observations state the measured area rather than claiming full-answer completion. */
export const RenderDiagnostic: FC<RenderDiagnosticProps> = ({ sessionId }) => {
  const timing = useRenderDiagnostic(sessionId);
  if (timing === null) return null;
  return (
    <div
      className="space-y-1 border-t border-border px-5 py-3 text-[11px] text-muted-foreground"
      aria-label="本机渲染诊断"
    >
      <p>
        最近事件 #{timing.seq} · 接收到列表提交 {traceDuration(timing.commitMs)} · 下一帧{' '}
        {traceDuration(timing.frameMs)}
      </p>
      <p>仅测量已挂载的对话列表；未挂载正文和屏幕实际呈现不在此计时范围。</p>
    </div>
  );
};
