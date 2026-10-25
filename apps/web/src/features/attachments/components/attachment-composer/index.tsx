import { BookOpen, FilePlus2, Plug, Plus } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover } from '@/components/ui/popover';
import { PopoverTrigger } from '@/components/ui/popover/popover-trigger';
import { PopoverContent } from '@/components/ui/popover/popover-content';
import { Notice } from '@/components/ui/notice';
import type { AttachmentComposerState } from '@/features/attachments/types/attachment';

export interface AttachmentComposerProps {
  state: AttachmentComposerState;
  locked: boolean;
}
/** Both composers share uploads and the explicit MCP selection entry. */
export const AttachmentComposer: FC<AttachmentComposerProps> = ({ state, locked }) => {
  return (
    <>
      <Input
        ref={state.input}
        type="file"
        multiple
        className="hidden"
        accept="text/*,.md,.json,.csv,.ts,.tsx,.js,.jsx,.py,.yaml,.yml,image/png,image/jpeg,image/webp,image/gif,application/pdf,.docx,.docm,.xlsx,.xlsm,.pptx,.pptm,.odt,.ods,.odp,.rtf,.epub"
        onChange={state.changeFiles}
        aria-label="上传附件"
        disabled={locked || state.upload.pending}
      />
      <Popover open={state.open} onOpenChange={state.setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            disabled={locked || state.upload.pending}
            aria-label="添加上下文"
          >
            <Plus width={18} height={18} aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-44 space-y-0.5 p-1" aria-label="添加上下文菜单">
          <Button
            type="button"
            variant="ghost"
            className="h-8 w-full justify-start px-2"
            onClick={state.choose}
          >
            <FilePlus2 width={16} height={16} aria-hidden />
            上传文件
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-8 w-full justify-start px-2"
            onClick={state.chooseMcp}
          >
            <Plug width={16} height={16} aria-hidden />
            MCP
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-8 w-full justify-start px-2"
            onClick={state.chooseSkill}
          >
            <BookOpen width={16} height={16} aria-hidden />
            Skill
          </Button>
        </PopoverContent>
      </Popover>
      {state.upload.pending && (
        <span className="text-xs text-muted-foreground" role="status">
          上传中…
        </span>
      )}
      {state.upload.error && <Notice tone="error">{state.upload.error}</Notice>}
    </>
  );
};
