import type { WorkspaceIcon } from '@my-pi-harness/protocol';
import {
  BookOpen,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  CodeXml,
  Cpu,
  Database,
  FlaskConical,
  FolderClosed,
  Gamepad2,
  Globe,
  GraduationCap,
  Heart,
  Music2,
  NotebookPen,
  Palette,
  Rocket,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export interface WorkspaceIconOption {
  id: WorkspaceIcon;
  label: string;
  Icon: LucideIcon;
}

/** Persisted icon ids stay independent of Lucide component names. */
export const WORKSPACE_ICON_OPTIONS: readonly WorkspaceIconOption[] = [
  { id: 'folder', label: '文件夹', Icon: FolderClosed },
  { id: 'code', label: '代码', Icon: CodeXml },
  { id: 'terminal', label: '终端', Icon: Terminal },
  { id: 'book', label: '书籍', Icon: BookOpen },
  { id: 'notebook', label: '笔记', Icon: NotebookPen },
  { id: 'briefcase', label: '工作', Icon: BriefcaseBusiness },
  { id: 'chart', label: '图表', Icon: ChartNoAxesCombined },
  { id: 'flask', label: '实验', Icon: FlaskConical },
  { id: 'globe', label: '网络', Icon: Globe },
  { id: 'palette', label: '设计', Icon: Palette },
  { id: 'music', label: '音乐', Icon: Music2 },
  { id: 'gamepad', label: '游戏', Icon: Gamepad2 },
  { id: 'cpu', label: '芯片', Icon: Cpu },
  { id: 'database', label: '数据库', Icon: Database },
  { id: 'graduation-cap', label: '学习', Icon: GraduationCap },
  { id: 'heart', label: '生活', Icon: Heart },
  { id: 'wrench', label: '工具', Icon: Wrench },
  { id: 'rocket', label: '探索', Icon: Rocket },
];

/** Resolves only protocol-owned icon ids; old registrations use the folder default. */
export const resolveWorkspaceIcon = (icon: WorkspaceIcon): LucideIcon => {
  const option = WORKSPACE_ICON_OPTIONS.find((entry) => {
    return entry.id === icon;
  });
  if (!option) {
    throw new Error(`未知工作区图标：${icon}`);
  }
  return option.Icon;
};

/** Filters the fixed icon catalog by a Chinese label or the persisted English id. */
export const filterWorkspaceIcons = (query: string): readonly WorkspaceIconOption[] => {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length === 0) {
    return WORKSPACE_ICON_OPTIONS;
  }
  return WORKSPACE_ICON_OPTIONS.filter((entry) => {
    return entry.label.includes(normalized) || entry.id.includes(normalized);
  });
};
