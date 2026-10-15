import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Popover } from '@/components/ui/popover';
import { PopoverContent } from '@/components/ui/popover/popover-content';
import { PopoverTrigger } from '@/components/ui/popover/popover-trigger';
import type { WorkspaceGroupState } from '@/features/workspaces/types/workspace-view';

interface WorkspaceActionsProps {
  name: string;
  managed: boolean;
  state: WorkspaceGroupState;
}
/** Separate overlay buttons preserve the folder row's full width and independent toggle action. */
export const WorkspaceActions: FC<WorkspaceActionsProps> = ({ name, managed, state }) => {
  return (
    <div className={state.actionsClassName}>
      {managed && (
        <Popover open={state.menuOpen} onOpenChange={state.changeMenuOpen}>
          <PopoverTrigger asChild>
            <Button
              ref={state.menuTrigger}
              type="button"
              size="icon"
              variant="ghost"
              className="h-6 w-6 rounded-md transition-none data-[state=open]:bg-accent"
              aria-label={`更多操作 ${name}`}
            >
              <MoreHorizontal width={16} height={16} aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-36 space-y-0.5 rounded-lg p-1.5"
            aria-label={`${name} 的工作区操作`}
            onCloseAutoFocus={state.closeMenuFocus}
          >
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-full justify-start rounded-md px-2 text-xs transition-none"
              onClick={state.rename}
            >
              <Pencil width={16} height={16} aria-hidden />
              重命名
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-full justify-start rounded-md px-2 text-xs text-error-solid transition-none hover:text-error-solid"
              onClick={state.remove}
            >
              <Trash2 width={16} height={16} aria-hidden />
              删除
            </Button>
          </PopoverContent>
        </Popover>
      )}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-6 w-6 rounded-md transition-none"
        aria-label={`在 ${name} 中新建对话`}
        onClick={state.newConversation}
      >
        <Plus width={16} height={16} aria-hidden />
      </Button>
    </div>
  );
};
