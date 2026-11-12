import type { FC } from 'react';
import { Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import type { SearchModelResourceProps } from '@/features/search/types/resources';

/** Each local model keeps its own readiness, truthful progress and explicit preparation controls. */
export const SearchModelResource: FC<SearchModelResourceProps> = ({
  title,
  view,
  pending,
  onPrepare,
  onCancel,
}) => {
  return (
    <div className="space-y-2 rounded-xl bg-muted/40 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          <Badge variant={view.tone}>{view.label}</Badge>
        </div>
        {view.canPrepare && (
          <Button
            type="button"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={onPrepare}
            disabled={pending}
            aria-label={`准备${title}`}
          >
            <Download width={13} height={13} aria-hidden />
            {view.prepareLabel}
          </Button>
        )}
        {view.canCancel && (
          <Button
            type="button"
            variant="outline"
            className="h-8 text-xs"
            onClick={onCancel}
            disabled={pending}
            aria-label={`取消准备${title}`}
          >
            取消准备
          </Button>
        )}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{view.description}</p>
      {view.progressLabel && <p className="text-xs text-muted-foreground">{view.progressLabel}</p>}
      {view.error && <Notice tone="error">{view.error}</Notice>}
    </div>
  );
};
