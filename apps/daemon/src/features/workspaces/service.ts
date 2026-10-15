import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { RuntimeError } from '@my-pi-harness/agent-runtime';
import { ExecutionError, resolveWorkspaceRoot } from '@my-pi-harness/execution';
import { WorkspaceSchema } from '@my-pi-harness/protocol';
import type {
  SessionCreateInput,
  Workspace,
  WorkspaceCreateInput,
  WorkspaceRenameInput,
} from '@my-pi-harness/protocol';
import type { ProfileStore } from '@my-pi-harness/storage';
import { Value } from 'typebox/value';

type WorkspaceStore = Pick<
  ProfileStore,
  'listWorkspaces' | 'getWorkspace' | 'createWorkspace' | 'renameWorkspace' | 'archiveWorkspace'
>;

function workspaceName(value: string): string {
  const name = value.trim();
  if (name.length === 0) throw new RuntimeError('WORKSPACE_NAME_INVALID', '工作区名称不能为空。');
  return name;
}

function defaultWorkspaceName(rootPath: string): string {
  const characters = Array.from(basename(rootPath).trim());
  while (
    characters.length > 0 &&
    !Value.Check(WorkspaceSchema.properties.name, characters.join(''))
  )
    characters.pop();
  return workspaceName(characters.join(''));
}

/** Owns directory registration; tool execution must still check each actual file target. */
export class WorkspaceService {
  public constructor(
    private readonly store: WorkspaceStore,
    private readonly profileDirectory: string,
  ) {}

  public list(): Workspace[] {
    return this.store.listWorkspaces();
  }

  public get(id: string): Workspace {
    const workspace = this.store.getWorkspace(id);
    if (!workspace) throw new RuntimeError('WORKSPACE_NOT_FOUND', '工作区不存在或已移除。');
    return workspace;
  }

  private async canonicalDirectory(rootPath: string): Promise<string> {
    try {
      return await resolveWorkspaceRoot({ rootPath, profileDirectory: this.profileDirectory });
    } catch (error: unknown) {
      if (!(error instanceof ExecutionError)) throw error;
      if (error.code === 'PROTECTED_PATH')
        throw new RuntimeError(
          'WORKSPACE_PATH_PROTECTED',
          '请选择独立的项目目录，不能使用系统根目录、用户主目录、应用数据目录或敏感目录。',
          { cause: error },
        );
      throw new RuntimeError('WORKSPACE_PATH_INVALID', '请选择已存在且可读取的绝对目录。', {
        cause: error,
      });
    }
  }

  public async create(input: WorkspaceCreateInput): Promise<Workspace> {
    const rootPath = await this.canonicalDirectory(input.rootPath);
    let name = input.name;
    if (name === undefined) name = defaultWorkspaceName(rootPath);
    const at = Date.now();
    return this.store.createWorkspace({
      id: randomUUID(),
      name: workspaceName(name),
      icon: input.icon ?? 'folder',
      rootPath,
      revision: 1,
      createdAt: at,
      updatedAt: at,
    });
  }

  public rename(id: string, input: WorkspaceRenameInput): Workspace {
    return this.store.renameWorkspace(
      id,
      { ...input, name: workspaceName(input.name) },
      Date.now(),
    );
  }

  public archive(id: string): void {
    this.store.archiveWorkspace(id);
  }

  /** Reject roots that disappeared or changed identity after registration. */
  public async requireAvailable(id: string): Promise<Workspace> {
    const workspace = this.get(id);
    const actual = await this.canonicalDirectory(workspace.rootPath);
    if (actual !== workspace.rootPath)
      throw new RuntimeError('WORKSPACE_PATH_CHANGED', '工作区目录已改变，请重新添加。');
    return workspace;
  }

  public async resolveSessionInput(input: SessionCreateInput): Promise<SessionCreateInput> {
    if (input.workspaceId !== undefined && input.workspaceId !== null)
      await this.requireAvailable(input.workspaceId);
    return {
      ...input,
      workspaceId: input.workspaceId ?? null,
      approvalMode: input.approvalMode ?? 'ask',
    };
  }
}
