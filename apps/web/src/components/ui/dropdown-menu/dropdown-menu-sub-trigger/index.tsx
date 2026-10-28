import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { ChevronRight } from 'lucide-react';
import type { ComponentProps, FC } from 'react';
import { cn } from '@/utils/cn';

/** Nested choices open by pointer or arrow key and indicate the submenu direction. */
export const DropdownMenuSubTrigger: FC<ComponentProps<typeof MenuPrimitive.SubTrigger>> = ({
  className,
  children,
  ...props
}) => {
  return (
    <MenuPrimitive.SubTrigger
      className={cn(
        'flex min-h-9 cursor-default items-center gap-2 rounded-xl px-2.5 py-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=open]:bg-accent',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight
        width={14}
        height={14}
        className="ml-auto shrink-0 text-muted-foreground"
        aria-hidden
      />
    </MenuPrimitive.SubTrigger>
  );
};
