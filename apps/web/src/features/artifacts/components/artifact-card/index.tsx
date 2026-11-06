import type { FC } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { useArtifactDownload } from '@/features/artifacts/hooks/use-artifact-download';
import { readToolArtifacts } from '@/features/artifacts/utils/artifacts';
import type { ArtifactCardProps, ToolArtifactsProps } from '@/features/artifacts/types/artifacts';

/** Registered files use the same delivery card for every producer and media type. */
export const ArtifactCard: FC<ArtifactCardProps> = ({ artifact }) => {
  const state = useArtifactDownload(artifact);
  return (
    <section aria-label="生成的文件" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 text-xs break-all">{artifact.sourcePath}</span>
        <Button
          type="button"
          variant="outline"
          onClick={state.download}
          disabled={state.pending}
          aria-label={`下载 ${state.filename}`}
        >
          <Download width={14} height={14} aria-hidden />
          下载文件
        </Button>
      </div>
      {state.error && <Notice tone="error">{state.error}</Notice>}
    </section>
  );
};

/** Tool transcripts expose only their persisted host-registered artifacts. */
export const ToolArtifacts: FC<ToolArtifactsProps> = ({ tool }) => {
  return readToolArtifacts(tool).map((artifact) => {
    return <ArtifactCard key={artifact.id} artifact={artifact} />;
  });
};
