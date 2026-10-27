import type {
  RemoteMcpInput,
  RemoteMcpView,
  RemoteMcpDraftTestInput,
} from '@my-pi-harness/protocol';
import type { RemoteMcpDraft } from '@/features/mcp/types/remote-mcp';
import {
  createRemoteMcpDraft,
  prepareRemoteMcpDraft,
} from '@/features/mcp/utils/remote-mcp-configuration';

export type RemoteMcpTestPlan =
  | { kind: 'saved'; server: RemoteMcpView }
  | { kind: 'draft'; input: RemoteMcpDraftTestInput; clearsSecrets: boolean };

/** Stored credentials may test only the unchanged configuration, never a partly replaced header set. */
export const prepareRemoteMcpTest = (
  draft: RemoteMcpDraft,
  original: RemoteMcpView | null,
): RemoteMcpTestPlan => {
  const prepared = prepareRemoteMcpDraft(draft, original);
  const hasSavedHeaders = prepared.input.secretHeaders.length > prepared.secrets.length;
  const hasSavedIdentity =
    original !== null && (prepared.input.oauth || prepared.input.connectionId !== undefined);
  if (hasSavedHeaders || hasSavedIdentity) {
    if (prepared.secrets.length > 0) {
      throw new Error('请填写本次测试的全部请求头值，或保存配置并完成授权后再测试。');
    }
    if (original === null || !original.enabled) {
      throw new Error('请填写本次测试的请求头值，或保存并信任此服务后再测试。');
    }
    const baseline = prepareRemoteMcpDraft(createRemoteMcpDraft(original), original).input;
    const comparable: RemoteMcpInput = { ...prepared.input, name: baseline.name };
    if (JSON.stringify(comparable) !== JSON.stringify(baseline)) {
      throw new Error('配置已修改，请重新填写测试请求头；已存凭据仅用于原配置。');
    }
    return { kind: 'saved', server: original };
  }
  const headers = { ...prepared.input.publicHeaders };
  for (const secret of prepared.secrets) {
    const slot = prepared.input.secretHeaders.find((entry) => {
      return entry.slotId === secret.slotId;
    });
    if (slot !== undefined) headers[slot.headerName] = secret.value;
  }
  return {
    kind: 'draft',
    input: { transport: prepared.input.transport, endpoint: prepared.input.endpoint, headers },
    clearsSecrets: prepared.secrets.length > 0,
  };
};
