import { Archive, ChevronDown, Download, LoaderCircle } from 'lucide-react';
import { useCallback, type FC } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu } from '@/components/ui/dropdown-menu';
import { DropdownMenuTrigger } from '@/components/ui/dropdown-menu/dropdown-menu-trigger';
import { DropdownMenuContent } from '@/components/ui/dropdown-menu/dropdown-menu-content';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu/dropdown-menu-item';
import { useArchiveStore } from '@/features/archives/stores/archives';

interface SessionLogMenuProps {
  sessionId: string;
  downloading: boolean;
  onDownloadLog: () => void;
}

/** JSONL remains available; full archives include the session's reachable immutable resources. */
export const SessionLogMenu: FC<SessionLogMenuProps> = ({
  sessionId,
  downloading,
  onDownloadLog,
}) => {
  const openExport = useArchiveStore((state) => {
    return state.openExport;
  });
  const exportArchive = useCallback((): void => {
    openExport(sessionId);
  }, [openExport, sessionId]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-8 gap-1.5 rounded-full px-3 text-xs"
          aria-label="对话日志与归档"
          aria-busy={downloading}
        >
          {!downloading && <Download width={14} height={14} aria-hidden />}
          {downloading && (
            <LoaderCircle
              width={14}
              height={14}
              className="animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          )}
          <span>对话日志</span>
          <ChevronDown width={12} height={12} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent aria-label="对话日志与归档选项">
        <DropdownMenuItem onSelect={onDownloadLog} disabled={downloading}>
          <Download width={14} height={14} aria-hidden />
          下载 JSONL 日志
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={exportArchive}>
          <Archive width={14} height={14} aria-hidden />
          导出完整归档
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
