import type { ProviderConfig, SessionSnapshot } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Notice } from '@/components/ui/notice';
import { ComposerSurface } from '@/features/sessions/components/composer-surface';
import { useNewSession } from '@/features/sessions/hooks/use-new-session';

interface NewConversationProps {
  providers: ProviderConfig[];
  onCreated: (snapshot: SessionSnapshot) => void;
  userName: string;
}

/** The initial workspace starts with the message itself, without a separate session creation form. */
export const NewConversation: FC<NewConversationProps> = ({ providers, onCreated, userName }) => {
  const state = useNewSession(providers, onCreated);
  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto px-6 pb-20 max-lg:px-5">
      <div className="w-full max-w-4xl space-y-5">
        <div className="space-y-2 px-1">
          <p className="text-lg font-semibold tracking-tight">Hi, {userName}</p>
          <h1 className="text-2xl font-medium tracking-tight">我们从哪里开始？</h1>
        </div>
        {state.invalid && (
          <Notice tone="error">
            保存的默认模型已不可用，请在输入框下选择其他模型，或打开设置更新配置。
          </Notice>
        )}
        <ComposerSurface id="new" {...state} />
      </div>
    </div>
  );
};
