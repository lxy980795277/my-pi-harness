import type { FC } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { useOfficeArtifact } from '@/features/office/hooks/use-office-artifact';
import type { OfficeArtifactProps } from '@/features/office/types/office';

/** Artifact delivery stays inside the expanded tool details. */
export const OfficeArtifact: FC<OfficeArtifactProps> = ({ tool }) => {
  const state = useOfficeArtifact(tool);
  if (state.artifact === null) return null;
  return (
    <section aria-label="生成的文档" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 text-xs break-all">{state.artifact.path}</span>
        <Button
          type="button"
          variant="outline"
          onClick={state.download}
          disabled={state.pending}
          aria-label={`下载 ${state.filename}`}
        >
          <Download width={14} height={14} aria-hidden />
          下载文档
        </Button>
      </div>
      {state.artifact.notVerified.map((item) => {
        return (
          <p key={item} className="text-xs text-warning-solid">
            尚未验证：{item}
          </p>
        );
      })}
      {state.error && <Notice tone="error">{state.error}</Notice>}
    </section>
  );
};
