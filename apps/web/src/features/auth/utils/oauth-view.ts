import type { SecretInputType } from '@/types/input';
import type { PromptPresentation } from '@/features/auth/types/auth';
import type { AuthFlow } from '@my-pi-harness/protocol';

import type { SelectOption } from '@/components/ui/select-field';

export const AUTH_STATUS_LABELS: Record<AuthFlow['status'], string> = {
  pending: '等待授权',
  completed: '授权完成',
  failed: '授权失败',
  cancelled: '授权已取消',
};

/** UI copy follows prompt semantics without guessing whether an empty answer is acceptable. */
export const getPromptPresentation = (
  prompt: NonNullable<AuthFlow['prompt']>,
): PromptPresentation => {
  let title = '补充登录信息';
  let label = prompt.message;
  let description = '请填写模型服务要求的登录信息。';
  let inputType: SecretInputType = 'text';
  let canSubmitEmpty = false;
  if (prompt.type === 'text') {
    canSubmitEmpty = true;
  }
  if (prompt.type === 'secret') {
    inputType = 'password';
  }
  if (prompt.type === 'manual_code') {
    title = '完成浏览器授权';
    label = '授权码或回调地址';
    description = '浏览器没有自动返回时，请粘贴授权码或完整的回调地址。';
  }
  if (prompt.type === 'select') {
    title = '选择登录方式';
    label = '登录方式';
    description = '请选择适合当前环境的 OAuth 授权方式。';
  }
  if (prompt.message.includes('GitHub Enterprise URL/domain')) {
    title = '选择 GitHub 登录范围';
    label = 'Enterprise 域名（可选）';
    description = '使用 GitHub.com 可直接留空；企业账号请填写 Enterprise 域名。';
  }
  const options: SelectOption[] = [];
  for (const option of prompt.options ?? []) {
    let optionLabel = option.label;
    if (option.id === 'browser') {
      optionLabel = '浏览器登录';
    }
    if (option.id === 'device_code') {
      optionLabel = '设备码登录';
    }
    options.push({ value: option.id, label: optionLabel, description: option.description });
  }
  return {
    title,
    label,
    description,
    inputType,
    canSubmitEmpty,
    options,
    placeholder: prompt.placeholder,
  };
};

/** Polling ends at a committed terminal state; there is no JSX or ternary in the policy. */
export const oauthRefetchInterval = (flow: AuthFlow | undefined): number | false => {
  if (flow?.status === 'pending') {
    return 1_000;
  }
  return false;
};
