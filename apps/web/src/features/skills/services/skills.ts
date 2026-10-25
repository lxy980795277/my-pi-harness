import { Type } from 'typebox';
import {
  SkillViewSchema,
  SkillDetailSchema,
  SkillResourceContentSchema,
  type SkillResourceContent,
  type SkillView,
  type SkillDetail,
  type SkillCreateInput,
  type SkillInstallInput,
} from '@my-pi-harness/protocol';
import { getJson, requestJson } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';

const query = (workspaceId: string | null): string => {
  if (workspaceId === null) return '';
  return `?workspaceId=${encodeURIComponent(workspaceId)}`;
};
/** Catalog requests contain metadata only; resource text is loaded explicitly. */
export const fetchSkills = async (
  workspaceId: string | null,
  signal: AbortSignal,
): Promise<SkillView[]> => {
  return parseResponse(
    Type.Array(SkillViewSchema),
    await getJson(`/skills${query(workspaceId)}`, signal),
  );
};
export const fetchSkillDetail = async (
  id: string,
  workspaceId: string | null,
  signal: AbortSignal,
): Promise<SkillDetail> => {
  return parseResponse(
    SkillDetailSchema,
    await getJson(`/skills/${encodeURIComponent(id)}${query(workspaceId)}`, signal),
  );
};
export const createSkill = async (
  input: SkillCreateInput,
  signal: AbortSignal,
): Promise<SkillView> => {
  return parseResponse(SkillViewSchema, await requestJson('/skills', 'POST', input, signal));
};
export const installSkill = async (
  input: SkillInstallInput,
  signal: AbortSignal,
): Promise<SkillView> => {
  return parseResponse(
    SkillViewSchema,
    await requestJson('/skills/install', 'POST', input, signal, 120000),
  );
};
export const setSkillEnabled = async (
  skill: SkillView,
  enabled: boolean,
  workspaceId: string | null,
  signal: AbortSignal,
): Promise<SkillView> => {
  return parseResponse(
    SkillViewSchema,
    await requestJson(
      `/skills/${encodeURIComponent(skill.id)}/control${query(workspaceId)}`,
      'POST',
      { contentHash: skill.contentHash, enabled },
      signal,
    ),
  );
};
export const removeSkill = async (
  skill: SkillView,
  workspaceId: string | null,
  signal: AbortSignal,
): Promise<void> => {
  await requestJson(
    `/skills/${encodeURIComponent(skill.id)}${query(workspaceId)}`,
    'DELETE',
    { contentHash: skill.contentHash },
    signal,
  );
};

/** Load a registered resource explicitly, with the observed content hash. */
export const readSkillResource = async (
  skill: SkillView,
  path: string,
  workspaceId: string | null,
  signal: AbortSignal,
): Promise<SkillResourceContent> => {
  return parseResponse(
    SkillResourceContentSchema,
    await requestJson(
      `/skills/${encodeURIComponent(skill.id)}/resources/read${query(workspaceId)}`,
      'POST',
      { contentHash: skill.contentHash, path },
      signal,
    ),
  );
};

/** The desktop bridge accepts only a registered Skill ID; browser fallback copies its verified path. */
export const revealSkillDirectory = async (
  skill: SkillView,
  workspaceId: string | null,
  signal: AbortSignal,
): Promise<void> => {
  if (window.desktop !== undefined) {
    await window.desktop.revealSkillDirectory(skill.id, workspaceId);
    return;
  }
  const directory = parseResponse(
    Type.Object({ path: Type.String() }, { additionalProperties: false }),
    await requestJson(
      `/skills/${encodeURIComponent(skill.id)}/directory${query(workspaceId)}`,
      'POST',
      undefined,
      signal,
    ),
  );
  await navigator.clipboard.writeText(directory.path);
};
