import type { FC } from 'react';
import { Badge } from '@/components/ui/badge';
import type { WorkDifference } from '@/features/work/types/work';
interface WorkDifferencesProps {
  rows: WorkDifference[];
}
/** Both summary versions and session snapshots compare persisted user-visible values. */
export const WorkDifferences: FC<WorkDifferencesProps> = ({ rows }) => {
  return (
    <div className="space-y-3">
      {rows.map((row) => {
        return (
          <div key={row.label} className="space-y-2 rounded-xl border border-border p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">{row.label}</span>
              {row.changed && <Badge>有变化</Badge>}
              {!row.changed && <span className="text-[11px] text-muted-foreground">相同</span>}
            </div>
            {row.changed && (
              <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                <div className="max-h-40 overflow-y-auto rounded-lg bg-muted p-2 text-xs break-words whitespace-pre-wrap">
                  {row.left}
                </div>
                <div className="max-h-40 overflow-y-auto rounded-lg bg-muted p-2 text-xs break-words whitespace-pre-wrap">
                  {row.right}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
