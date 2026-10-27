import type { ApprovalMode, ToolCallView } from '@my-pi-harness/protocol';
import { Hand, LockKeyhole, ShieldAlert, ShieldCheck, type LucideIcon } from 'lucide-react';

interface ApprovalOption {
  value: ApprovalMode;
  label: string;
  description: string;
  Icon: LucideIcon;
  className: string;
}

export interface ApprovalAuditView {
  label: string;
  reason: string | null;
  Icon: LucideIcon;
  className: string;
}

const FULL_ACCESS_CLASS = 'text-warning-solid focus:text-warning-solid [&_p]:text-warning-solid';

/** New selections expose three supported strategies; legacy read-only remains display-only. */
export const APPROVAL_OPTIONS: readonly ApprovalOption[] = [
  {
    value: 'ask',
    label: '请求批准',
    description: '修改工作区文件、执行命令和工具调用前询问',
    Icon: Hand,
    className: '',
  },
  {
    value: 'auto',
    label: '帮我批准',
    description: '由独立 AI 复核文件修改、命令和工具调用',
    Icon: ShieldCheck,
    className: '',
  },
  {
    value: 'full-access',
    label: '完全访问权限',
    description: '自动批准工具调用；命令不受沙箱限制',
    Icon: ShieldAlert,
    className: FULL_ACCESS_CLASS,
  },
];

const LEGACY_READ_ONLY: ApprovalOption = {
  value: 'read-only',
  label: '只读',
  description: '保留旧会话限制，禁止文件修改和命令执行',
  Icon: LockKeyhole,
  className: '',
};

const SOURCE_LABELS = { user: '用户决定', ai: 'AI 复核', 'full-access': '完全访问权限' } as const;
const DECISION_LABELS = { allow: '已批准', deny: '已拒绝', ask: '转人工确认' } as const;

/** The trigger reflects a legacy mode without adding it to the new-choice menu or elevating it. */
export const approvalPresentation = (mode: ApprovalMode): ApprovalOption => {
  if (mode === 'read-only') {
    return LEGACY_READ_ONLY;
  }
  const option = APPROVAL_OPTIONS.find((entry) => {
    return entry.value === mode;
  });
  if (!option) {
    throw new Error('权限模式不受当前客户端支持。');
  }
  return option;
};

/** Shows only the public audit outcome; private reviewer inputs are never part of this view. */
export const approvalAuditView = (approval: ToolCallView['approval']): ApprovalAuditView | null => {
  if (!approval) {
    return null;
  }
  let Icon = Hand;
  let className = '';
  if (approval.source === 'ai') {
    Icon = ShieldCheck;
  }
  if (approval.source === 'full-access') {
    Icon = ShieldAlert;
    className = 'text-warning-solid';
  }
  return {
    label: `${SOURCE_LABELS[approval.source]} · ${DECISION_LABELS[approval.decision]}`,
    reason: approval.reason,
    Icon,
    className,
  };
};

/** AI review is not an answerable user prompt; actions appear only after the host registers a wait. */
export const toolNeedsApproval = (status: ToolCallView['status']): boolean => {
  return status === 'awaiting_approval';
};
