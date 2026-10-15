import type { ApprovalMode } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Select } from '@/components/ui/select';
import { SelectContent } from '@/components/ui/select/select-content';
import { SelectItem } from '@/components/ui/select/select-item';
import { SelectTrigger } from '@/components/ui/select/select-trigger';
import { SelectValue } from '@/components/ui/select/select-value';
import { APPROVAL_OPTIONS, approvalPresentation } from '@/features/sessions/utils/approval-options';
import { cn } from '@/utils/cn';

interface ApprovalSelectProps {
  id: string;
  value: ApprovalMode;
  disabled: boolean;
  onValueChange: (value: string) => void;
}
/** Permission choices own their icon, description and warning color without changing other selects. */
export const ApprovalSelect: FC<ApprovalSelectProps> = ({ id, value, disabled, onValueChange }) => {
  const current = approvalPresentation(value);
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        id={id}
        aria-label="执行批准方式"
        className={cn(
          'h-8 w-auto max-w-44 justify-start gap-1.5 rounded-lg border-transparent bg-transparent px-1 text-xs shadow-none',
          current.className,
        )}
      >
        <current.Icon width={16} height={16} className="shrink-0" aria-hidden />
        <SelectValue>{current.label}</SelectValue>
      </SelectTrigger>
      <SelectContent className="w-96 max-w-[calc(100vw-2rem)]">
        {APPROVAL_OPTIONS.map((option) => {
          return (
            <SelectItem
              key={option.value}
              value={option.value}
              aria-label={option.label}
              textValue={option.label}
              description={option.description}
              icon={<option.Icon width={16} height={16} aria-hidden />}
              className={cn('items-start py-2.5 [&>span:first-child]:mt-0.5', option.className)}
            >
              {option.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
};
