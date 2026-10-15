import { describe, expect, it } from 'vitest';
import {
  APPROVAL_OPTIONS,
  approvalAuditView,
  approvalPresentation,
  toolNeedsApproval,
} from '../src/features/sessions/utils/approval-options';
import { readApprovalMode } from '../src/features/sessions/utils/composer-options';

describe('permission choices and persisted approval outcomes', () => {
  it('offers only the three current policies while preserving the legacy read-only trigger', () => {
    expect(
      APPROVAL_OPTIONS.map((option) => {
        return option.value;
      }),
    ).toEqual(['ask', 'auto', 'full-access']);
    expect(approvalPresentation('read-only').label).toBe('只读');
    expect(readApprovalMode('read-only')).toBe('read-only');
    expect(readApprovalMode('auto')).toBe('auto');
    expect(readApprovalMode('full-access')).toBe('full-access');
    expect(readApprovalMode('unsupported')).toBeNull();
  });

  it('never presents an AI review as an answerable manual prompt', () => {
    expect(toolNeedsApproval('reviewing')).toBe(false);
    expect(toolNeedsApproval('awaiting_approval')).toBe(true);
    expect(toolNeedsApproval('running')).toBe(false);
  });

  it('retains public approval provenance and reasons without inventing outcomes for old records', () => {
    expect(approvalAuditView(undefined)).toBeNull();
    expect(
      approvalAuditView({ source: 'ai', decision: 'ask', reason: '需要用户明确目标。' }),
    ).toMatchObject({ label: 'AI 复核 · 转人工确认', reason: '需要用户明确目标。' });
    expect(approvalAuditView({ source: 'user', decision: 'deny', reason: null })).toMatchObject({
      label: '用户决定 · 已拒绝',
      reason: null,
    });
    expect(
      approvalAuditView({ source: 'full-access', decision: 'allow', reason: null })?.label,
    ).toBe('完全访问权限 · 已批准');
  });
});
