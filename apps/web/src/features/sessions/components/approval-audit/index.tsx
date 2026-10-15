import type { ToolCallView } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { approvalAuditView } from '@/features/sessions/utils/approval-options';
import { cn } from '@/utils/cn';
interface ApprovalAuditProps {
  approval: ToolCallView['approval'];
}
/** Persisted approval provenance and the public reason stay readable after refresh or restart. */
export const ApprovalAudit: FC<ApprovalAuditProps> = ({ approval }) => {
  const view = approvalAuditView(approval);
  if (!view) {
    return null;
  }
  return (
    <div
      aria-label="审批记录"
      className="space-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground"
    >
      <span className={cn('flex items-center gap-1.5', view.className)}>
        <view.Icon width={14} height={14} aria-hidden />
        {view.label}
      </span>
      {view.reason && (
        <div className="leading-6 break-words whitespace-pre-wrap">{view.reason}</div>
      )}
    </div>
  );
};
