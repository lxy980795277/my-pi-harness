import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { useId, type ComponentProps, type FC } from 'react';
import { cn } from '@/utils/cn';

interface DropdownMenuRadioItemProps extends ComponentProps<typeof MenuPrimitive.RadioItem> {
  description?: string | undefined;
}

/** Menu options expose checked state and associate optional explanatory text. */
export const DropdownMenuRadioItem: FC<DropdownMenuRadioItemProps> = ({
  className,
  children,
  description,
  ...props
}) => {
  const descriptionId = useId();
  let describedBy: string | undefined;
  if (description) describedBy = descriptionId;
  return (
    <MenuPrimitive.RadioItem
      className={cn(
        'relative flex cursor-default items-center gap-2 rounded-xl py-2 pr-8 pl-2.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
        className,
      )}
      aria-describedby={describedBy}
      {...props}
    >
      <div className="min-w-0 space-y-0.5">
        <span className="block truncate">{children}</span>
        {description && (
          <p id={descriptionId} className="text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <MenuPrimitive.ItemIndicator className="absolute right-2.5 flex items-center justify-center">
        <Check width={14} height={14} aria-hidden />
      </MenuPrimitive.ItemIndicator>
    </MenuPrimitive.RadioItem>
  );
};
