import { useCallback, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SkillView, SkillCreateInput } from '@my-pi-harness/protocol';
import {
  fetchSkillDetail,
  fetchSkills,
  createSkill,
  installSkill,
  removeSkill,
  setSkillEnabled,
  readSkillResource,
  revealSkillDirectory,
} from '@/features/skills/services/skills';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces';
import { selectedSkillResource } from '@/features/skills/utils/skill-resource-preview';
import type {
  SkillDraft,
  SkillFormMode,
  SkillSettingsAction,
  SkillsSettingsState,
  SkillResourcePreview,
} from '@/features/skills/types/skill';

const INITIAL: SkillDraft = {
  name: '',
  description: '',
  content: '',
  owner: '',
  repository: '',
  ref: 'main',
  path: '',
};
/** Settings reads server facts while forms and cancellation stay local to the mounted page. */
export const useSkillsSettings = (): SkillsSettingsState => {
  const queryClient = useQueryClient();
  const workspaces = useWorkspaces();
  const [workspace, setWorkspace] = useState('user');
  let workspaceId: string | null = workspace;
  if (workspace === 'user') workspaceId = null;
  const catalog = useQuery({
    queryKey: ['skills', workspaceId],
    queryFn: ({ signal }) => {
      return fetchSkills(workspaceId, signal);
    },
  });
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ['skill-detail', selected, workspaceId],
    queryFn: ({ signal }) => {
      if (selected === null) throw new Error('未选择 Skill');
      return fetchSkillDetail(selected, workspaceId, signal);
    },
    enabled: selected !== null,
  });
  const [resourcePreview, setResourcePreview] = useState<SkillResourcePreview | null>(null);
  const [mode, setMode] = useState<SkillFormMode>('closed');
  const [draft, setDraft] = useState<SkillDraft>(INITIAL);
  const [controller, setController] = useState<AbortController | null>(null);
  const refresh = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['skills'] });
    await queryClient.invalidateQueries({ queryKey: ['skill-detail'] });
  }, [queryClient]);
  const previewResource = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, skill: SkillView, resourcePath: string): Promise<void> => {
        const resource = await readSkillResource(skill, resourcePath, workspaceId, signal);
        signal.throwIfAborted();
        setResourcePreview({
          skillId: skill.id,
          contentHash: skill.contentHash,
          workspaceId,
          resource,
        });
      },
      [workspaceId],
    ),
  );
  const { cancel: cancelPreview } = previewResource;
  const operation = useAsyncEvent(
    useCallback(
      async (
        signal: AbortSignal,
        action: SkillSettingsAction,
        skill?: SkillView,
      ): Promise<void> => {
        if (action === 'directory' && skill !== undefined) {
          await revealSkillDirectory(skill, workspaceId, signal);
          return;
        }
        if (action === 'save') {
          const active = new AbortController();
          setController(active);
          let scope: SkillCreateInput['scope'] = 'project';
          if (workspaceId === null) scope = 'user';
          try {
            const combined = AbortSignal.any([signal, active.signal]);
            if (mode === 'create')
              await createSkill(
                {
                  scope,
                  workspaceId,
                  name: draft.name,
                  description: draft.description,
                  content: draft.content,
                },
                combined,
              );
            if (mode === 'install')
              await installSkill(
                {
                  scope,
                  workspaceId,
                  owner: draft.owner,
                  repository: draft.repository,
                  ref: draft.ref,
                  path: draft.path,
                },
                combined,
              );
            setMode('closed');
            setDraft(INITIAL);
          } finally {
            setController(null);
            await refresh();
          }
        } else if (skill !== undefined) {
          if (action === 'toggle')
            await setSkillEnabled(skill, !skill.enabled, workspaceId, signal);
          if (action === 'remove') {
            await removeSkill(skill, workspaceId, signal);
            setSelected((current) => {
              if (current === skill.id) return null;
              return current;
            });
          }
          await refresh();
        }
      },
      [draft, mode, refresh, workspaceId],
    ),
  );
  const changeField = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      const name = event.target.name;
      const value = event.target.value;
      setDraft((previous) => {
        return { ...previous, [name]: value };
      });
    },
    [],
  );
  const create = useCallback((): void => {
    setMode('create');
  }, []);
  const install = useCallback((): void => {
    setMode('install');
  }, []);
  const closeForm = useCallback((): void => {
    controller?.abort();
    setMode('closed');
  }, [controller]);
  const save = useCallback((): void => {
    operation.run('save');
  }, [operation]);
  const rows = (catalog.data ?? []).map((skill) => {
    return {
      skill,
      show: (): void => {
        cancelPreview();
        setSelected(skill.id);
        setResourcePreview(null);
      },
      toggle: (): void => {
        operation.run('toggle', skill);
      },
      remove: (): void => {
        operation.run('remove', skill);
      },
      directory: (): void => {
        operation.run('directory', skill);
      },
      canRemove: skill.managed && skill.pluginId === null,
      canToggle: skill.pluginId === null,
    };
  });
  const workspaceOptions = [
    { value: 'user', label: '用户作用域' },
    ...(workspaces.data ?? []).map((entry) => {
      return { value: entry.id, label: entry.name };
    }),
  ];
  const resources = (detail.data?.resources ?? []).map((resource) => {
    return {
      ...resource,
      open: (): void => {
        if (detail.data !== undefined) previewResource.run(detail.data, resource.path);
      },
    };
  });
  let directoryLabel = '复制目录路径';
  if (window.desktop !== undefined) directoryLabel = '打开目录';
  const changeWorkspace = useCallback(
    (value: string): void => {
      cancelPreview();
      setWorkspace(value);
      setSelected(null);
      setResourcePreview(null);
    },
    [cancelPreview],
  );
  const resource = selectedSkillResource(resourcePreview, detail.data, workspaceId);
  let resourceText: string | null = null;
  let resourceImage: string | null = null;
  if (resource?.type === 'text') resourceText = resource.text;
  else if (resource?.type === 'image')
    resourceImage = `data:${resource.mimeType};base64,${resource.data}`;
  return {
    directoryLabel,
    resources,
    resourceText,
    resourceImage,
    catalog,
    detail,
    rows,
    mode,
    draft,
    workspace,
    workspaceOptions,
    changeWorkspace,
    changeField,
    create,
    install,
    closeForm,
    save,
    pending: operation.pending || previewResource.pending,
    error: operation.error ?? previewResource.error,
  };
};
