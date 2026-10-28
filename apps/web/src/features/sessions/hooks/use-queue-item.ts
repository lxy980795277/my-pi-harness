import type { QueueItemState } from '@/features/sessions/types/session';
import type {
  ApprovalMode,
  McpToolSelection,
  SkillSelection,
  QueueInput,
  QueuePatchInput,
} from '@my-pi-harness/protocol';
import { useCallback, useState, type ChangeEvent } from 'react';
import { useSkillSelection } from '@/features/skills/hooks/use-skill-selection';
import { useMcpSelection } from '@/features/mcp/hooks/use-mcp-selection';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Queue edits keep the revision captured when editing starts until the draft is saved or cancelled. */
export const useQueueItem = (
  input: QueueInput,
  workspaceId: string | null,
  approvalMode: ApprovalMode,
  running: boolean,
  onUpdate: (id: string, patch: QueuePatchInput) => Promise<void>,
  onDelete: (id: string) => Promise<void>,
): QueueItemState => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<QueuePatchInput>({
    text: input.text,
    revision: input.revision,
  });
  const [mcpTools, setMcpTools] = useState<McpToolSelection[]>(input.mcpTools ?? []);
  let selected = input.mcpTools ?? [];
  if (editing) {
    selected = mcpTools;
  }
  const mcp = useMcpSelection(
    selected,
    setMcpTools,
    workspaceId,
    approvalMode,
    !editing || running,
  );
  const [skillSelections, setSkillSelections] = useState<SkillSelection[]>(input.skills ?? []);
  let selectedSkills = input.skills ?? [];
  if (editing) selectedSkills = skillSelections;
  const skills = useSkillSelection(
    selectedSkills,
    setSkillSelections,
    workspaceId,
    !editing || running,
  );
  const update = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        if (mcp.blocked || skills.blocked) {
          return;
        }
        await onUpdate(input.id, {
          text: draft.text.trim(),
          revision: draft.revision,
          mcpTools: mcp.selected,
          skills: skills.selected,
        });
        signal.throwIfAborted();
        setEditing(false);
      },
      [draft, input.id, mcp.blocked, mcp.selected, skills.blocked, skills.selected, onUpdate],
    ),
  );
  const { clearError: updateClearError } = update;
  const remove = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await onDelete(input.id);
    }, [input.id, onDelete]),
  );
  const start = useCallback((): void => {
    setDraft({ text: input.text, revision: input.revision });
    setMcpTools(input.mcpTools ?? []);
    setSkillSelections(input.skills ?? []);
    updateClearError();
    setEditing(true);
  }, [input.mcpTools, input.skills, input.revision, input.text, updateClearError]);
  const cancel = useCallback((): void => {
    setEditing(false);
    setDraft({ text: input.text, revision: input.revision });
    updateClearError();
  }, [input.revision, input.text, updateClearError]);
  const changeText = useCallback((event: ChangeEvent<HTMLTextAreaElement>): void => {
    const text = event.target.value;
    setDraft((current) => {
      return { ...current, text };
    });
  }, []);
  let error = update.error;
  if (error === null) {
    error = remove.error;
  }
  return {
    editing,
    mcp,
    skills,
    text: draft.text,
    changeText,
    start,
    cancel,
    update: update.run,
    remove: remove.run,
    pending: update.pending || remove.pending,
    error: error,
  };
};
