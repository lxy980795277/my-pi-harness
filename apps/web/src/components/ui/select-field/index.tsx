import type { FC, ReactNode } from 'react';

import { Select } from '@/components/ui/select';
import { SelectContent } from '@/components/ui/select/select-content';
import { SelectItem } from '@/components/ui/select/select-item';
import { SelectTrigger } from '@/components/ui/select/select-trigger';
import { SelectValue } from '@/components/ui/select/select-value';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  description?: string | undefined;
  icon?: ReactNode;
}

interface SelectFieldProps {
  id: string;
  value: string;
  options: readonly SelectOption[];
  placeholder?: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

/** Shared composition of the actual shadcn select primitives for prepared options. */
export const SelectField: FC<SelectFieldProps> = ({
  id,
  value,
  options,
  placeholder,
  onValueChange,
  disabled = false,
  className,
  ariaLabel,
}) => {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} className={className} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => {
          return (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.disabled ?? false}
              description={option.description}
              icon={option.icon}
              aria-label={option.label}
            >
              {option.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
};
