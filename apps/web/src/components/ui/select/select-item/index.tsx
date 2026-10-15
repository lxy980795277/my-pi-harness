import * as SelectPrimitive from '@radix-ui/react-select';
import { Check } from 'lucide-react';
import { useId, type ComponentProps, type FC, type ReactNode } from 'react';

import { cn } from '@/utils/cn';

type SelectItemProps = ComponentProps<typeof SelectPrimitive.Item> & {
  description?: string | undefined;
  icon?: ReactNode;
};

/** Select item keeps focus, selection and disabled states under the primitive owner. */
export const SelectItem: FC<SelectItemProps> = ({
  className,
  children,
  description,
  icon,
  ...props
}) => {
  const generatedId = useId();
  let descriptionId: string | undefined;
  if (description) {
    descriptionId = generatedId;
  }
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex cursor-default items-center rounded-lg py-2 pr-8 pl-3 text-xs outline-none select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
      aria-describedby={descriptionId}
    >
      {icon && (
        <span className="mr-2 flex shrink-0" aria-hidden>
          {icon}
        </span>
      )}
      <div className="space-y-1">
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        {description && (
          <p id={descriptionId} className="max-w-80 text-[11px] leading-5 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center justify-center">
        <Check width={14} height={14} aria-hidden />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
};
