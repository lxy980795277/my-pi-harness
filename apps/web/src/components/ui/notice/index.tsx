import type { NoticeTone } from '@/components/ui/notice/types';
import type { FC, PropsWithChildren } from 'react';

import { cn } from '@/utils/cn';

interface NoticeProps extends PropsWithChildren {
  tone?: NoticeTone;
}

const TONE_CLASSES = {
  info: 'border-border bg-muted text-muted-foreground',
  error: 'border-error-solid bg-error text-error-foreground',
  success: 'border-success-solid bg-success text-success-foreground',
} as const;

const TONE_ROLES = { info: 'status', error: 'alert', success: 'status' } as const;

/** Announces an actionable result without using color as its only signal. */
export const Notice: FC<NoticeProps> = ({ tone = 'info', children }) => {
  return (
    <div
      role={TONE_ROLES[tone]}
      className={cn('rounded-lg border px-3 py-2 text-xs leading-6', TONE_CLASSES[tone])}
    >
      {children}
    </div>
  );
};
