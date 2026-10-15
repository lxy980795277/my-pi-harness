import type { WorkspaceIcon as WorkspaceIconId } from '@my-pi-harness/protocol';
import { FolderClosed, FolderOpen } from 'lucide-react';
import type { FC } from 'react';
import { resolveWorkspaceIcon } from '@/components/workspace-icon/workspace-icons';

interface WorkspaceIconProps {
  icon: WorkspaceIconId;
  expanded?: boolean;
  className?: string;
  width?: number;
  height?: number;
}

/** Default folders follow expansion while custom icons retain their selected symbol. */
export const WorkspaceIcon: FC<WorkspaceIconProps> = ({
  icon,
  expanded = false,
  className,
  width = 16,
  height = 16,
}) => {
  let Icon = resolveWorkspaceIcon(icon);
  if (icon === 'folder') {
    Icon = FolderClosed;
    if (expanded) {
      Icon = FolderOpen;
    }
  }
  return (
    <Icon
      width={width}
      height={height}
      className={className}
      data-workspace-icon={icon}
      aria-hidden
    />
  );
};
