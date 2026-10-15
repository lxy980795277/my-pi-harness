import type { FC, PropsWithChildren } from 'react';

import { Label } from '@/components/ui/label';

interface FieldProps extends PropsWithChildren {
  label: string;
  htmlFor: string;
  description?: string;
}

/** Associates a visible label and optional explanation with its form control. */
export const Field: FC<FieldProps> = ({ label, htmlFor, description, children }) => {
  return (
    <div className="space-y-1.5">
      <Label className="block" htmlFor={htmlFor}>
        {label}
      </Label>
      {children}
      {description && <p className="text-xs leading-5 text-muted-foreground">{description}</p>}
    </div>
  );
};
