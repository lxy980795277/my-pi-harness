import type { LucideIcon } from 'lucide-react';
import type { Action } from '@/types/events';

export interface ToolPresentation {
  name: string;
  Icon: LucideIcon;
  summary: string;
  statusLabel: string;
  statusClassName: string;
  showStatus: boolean;
  busy: boolean;
}

export interface ToolCardState extends ToolPresentation {
  argumentsText: string;
  needsApproval: boolean;
  detailsOpen: boolean;
  detailsLabel: string;
  toggleDetails: Action;
  allow: Action;
  deny: Action;
  pending: boolean;
  error: string | null;
}
