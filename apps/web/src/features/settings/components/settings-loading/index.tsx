import { LoaderCircle } from 'lucide-react';
import type { FC } from 'react';

/** The settings dialog remains interactive while its model controls load. */
export const SettingsLoading: FC = () => {
  return (
    <div
      role="status"
      className="flex min-h-80 items-center justify-center gap-3 px-6 py-10 text-sm text-muted-foreground"
    >
      <LoaderCircle
        width={18}
        height={18}
        className="animate-spin motion-reduce:animate-none"
        aria-hidden
      />
      <span>正在加载设置…</span>
    </div>
  );
};
