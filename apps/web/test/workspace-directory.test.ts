import { WORKSPACE_ICONS } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import {
  filterWorkspaceIcons,
  resolveWorkspaceIcon,
  WORKSPACE_ICON_OPTIONS,
} from '../src/components/workspace-icon/workspace-icons';
import {
  readWorkspaceDrop,
  workspaceDirectoryName,
} from '../src/features/workspaces/utils/workspace-directory';

describe('workspace folder selection', () => {
  it('shows directory labels for both host path formats without changing their paths', () => {
    expect(workspaceDirectoryName('/Users/test/project/')).toBe('project');
    expect(workspaceDirectoryName('C:\\Users\\test\\project')).toBe('project');
    expect(workspaceDirectoryName('/')).toBe('/');
    expect(workspaceDirectoryName('')).toBe('');
  });

  it('rejects empty and multiple drops before calling the native directory resolver', () => {
    const directory = new File([], 'project');
    expect(readWorkspaceDrop([directory])).toBe(directory);
    expect(() => {
      readWorkspaceDrop([]);
    }).toThrow('每次只能添加一个文件夹');
    expect(() => {
      readWorkspaceDrop([directory, directory]);
    }).toThrow('每次只能添加一个文件夹');
  });
});

describe('workspace icon catalog', () => {
  it('renders every persisted protocol icon exactly once', () => {
    const ids = WORKSPACE_ICON_OPTIONS.map((option) => {
      expect(resolveWorkspaceIcon(option.id)).toBe(option.Icon);
      return option.id;
    });
    expect(ids).toEqual(WORKSPACE_ICONS);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('searches labels and ids without modifying the fixed catalog', () => {
    expect(filterWorkspaceIcons('  CODE  ')).toEqual([WORKSPACE_ICON_OPTIONS[1]]);
    expect(filterWorkspaceIcons('学习')[0]?.id).toBe('graduation-cap');
    expect(filterWorkspaceIcons('unknown')).toEqual([]);
    expect(filterWorkspaceIcons('')).toBe(WORKSPACE_ICON_OPTIONS);
  });
});
