import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { SelectField } from '@/components/ui/select-field';
import { OAuthFlowPanel } from '@/features/auth/components/oauth-flow-panel';
import { useAuthFlowWorkspace } from '@/features/auth/hooks/use-auth-flow-workspace';
import { describeError } from '@/utils/describe-error';

/** Application identity progress is independent of model-provider credentials. */
export const AuthFlowWorkspace: FC = () => {
  const state = useAuthFlowWorkspace();
  return (
    <>
      {state.query.isError && (
        <div className="px-4 py-2">
          <Notice tone="error">{describeError(state.query.error)}</Notice>
        </div>
      )}
      {state.options.length > 0 && (
        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
          <Label htmlFor="selected-auth-flow">授权进度</Label>
          <SelectField
            id="selected-auth-flow"
            className="h-8 w-52 text-xs"
            value={state.activeId}
            onValueChange={state.select}
            options={state.options}
            placeholder="选择授权流程"
          />
          {!state.visible && state.activeId && (
            <Button type="button" variant="ghost" onClick={state.show}>
              查看授权进度
            </Button>
          )}
        </div>
      )}
      {state.visible && state.activeId && (
        <div className="max-h-96 shrink-0 overflow-y-auto p-4">
          <OAuthFlowPanel key={state.activeId} flowId={state.activeId} onClose={state.hide} />
        </div>
      )}
    </>
  );
};
