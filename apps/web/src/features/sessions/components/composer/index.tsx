import type {
  InputRequest,
  ProviderConfig,
  SessionPatchInput,
  SessionSummary,
} from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { ComposerSurface } from '@/features/sessions/components/composer-surface';
import { useComposer } from '@/features/sessions/hooks/use-composer';
import { useComposerChoices } from '@/features/sessions/hooks/use-composer-choices';

interface ComposerProps {
  session: SessionSummary;
  providers: ProviderConfig[];
  onSend: (input: InputRequest) => Promise<void>;
  onStop: () => Promise<void>;
  onPatch: (input: SessionPatchInput) => Promise<void>;
}

/** The ongoing conversation uses the same controls as first send while preserving queue and stop. */
export const Composer: FC<ComposerProps> = ({ session, providers, onSend, onStop, onPatch }) => {
  const state = useComposer(session.id, session.activeRunId, onSend, onStop);
  const selection = useComposerChoices(session, providers, onPatch);
  return (
    <div className="shrink-0 px-5 pt-2 pb-2 sm:px-6">
      <div className="mx-auto w-full max-w-4xl">
        <ComposerSurface
          id={session.id}
          {...state}
          choices={selection.choices}
          disabled={state.disabled || selection.submitBlocked}
          error={state.error ?? selection.error}
          footer={null}
        />
      </div>
    </div>
  );
};
