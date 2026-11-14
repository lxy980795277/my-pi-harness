import { Import } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { useArchiveStore } from '@/features/archives/stores/archives';

/** Import is an application-level action, independent from the selected conversation. */
export const ArchiveEntry: FC = () => {
  const open = useArchiveStore((state) => {
    return state.openImport;
  });
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-10 w-full justify-start gap-3 rounded-2xl px-3 text-sm text-muted-foreground"
      onClick={open}
    >
      <Import width={18} height={18} aria-hidden />
      导入会话
    </Button>
  );
};
