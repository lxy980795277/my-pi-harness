import type { MessageEditorState } from '@/features/sessions/types/session';
import type {
  ApprovalMode,
  EditInput,
  McpToolSelection,
  MessageView,
  SkillSelection,
} from '@my-pi-harness/protocol';
import { useCallback, useRef, useState, type ChangeEvent, type SubmitEvent } from 'react';
import { useSkillSelection } from '@/features/skills/hooks/use-skill-selection';
import { useMcpSelection } from '@/features/mcp/hooks/use-mcp-selection';
import { mcpSelectionKey } from '@/features/mcp/utils/mcp-selection';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Editing retries retain one request id until the branch creation is acknowledged. */
export const useMessageEditor = (
  message: MessageView,
  workspaceId: string | null,
  approvalMode: ApprovalMode,
  onEdit: (input: EditInput) => Promise<void>,
): MessageEditorState => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.text);
  const [mcpTools, setMcpTools] = useState<McpToolSelection[]>(message.mcpTools ?? []);
  const mcp = useMcpSelection(
    mcpTools,
    setMcpTools,
    workspaceId,
    approvalMode,
    false,
    false,
    editing,
  );
  const [skillSelections, setSkillSelections] = useState<SkillSelection[]>(message.skills ?? []);
  const skills = useSkillSelection(
    skillSelections,
    setSkillSelections,
    workspaceId,
    false,
    editing,
  );
  const attempt = useRef<EditInput | null>(null);
  const edit = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, input: EditInput): Promise<void> => {
        await onEdit(input);
        signal.throwIfAborted();
        setEditing(false);
        attempt.current = null;
      },
      [onEdit],
    ),
  );
  const { clearError: editClearError } = edit;
  const { run: editRun } = edit;
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (mcp.blocked || skills.blocked) {
        return;
      }
      const trimmed = text.trim();
      let requestId: string = crypto.randomUUID();
      if (
        attempt.current?.text === trimmed &&
        JSON.stringify(attempt.current.skills) === JSON.stringify(skills.selected) &&
        JSON.stringify(attempt.current.mcpTools?.map(mcpSelectionKey)) ===
          JSON.stringify(mcp.selected.map(mcpSelectionKey))
      ) {
        requestId = attempt.current.requestId;
      }
      const input = {
        messageId: message.id,
        text: trimmed,
        requestId,
        mcpTools: mcp.selected,
        skills: skills.selected,
      };
      attempt.current = input;
      editRun(input);
    },
    [editRun, mcp.blocked, mcp.selected, skills.blocked, skills.selected, message.id, text],
  );
  const start = useCallback((): void => {
    setText(message.text);
    setMcpTools(message.mcpTools ?? []);
    setSkillSelections(message.skills ?? []);
    setEditing(true);
    editClearError();
  }, [editClearError, message.mcpTools, message.skills, message.text]);
  const cancel = useCallback((): void => {
    setEditing(false);
    editClearError();
  }, [editClearError]);
  const changeText = useCallback((event: ChangeEvent<HTMLTextAreaElement>): void => {
    setText(event.target.value);
  }, []);
  return {
    editing,
    mcp,
    skills,
    text,
    changeText,
    submit,
    start,
    cancel,
    pending: edit.pending,
    error: edit.error,
  };
};
