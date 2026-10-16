import type { PlanStep } from '@my-pi-harness/protocol';
import { CheckCircle2, Circle, CircleDot } from 'lucide-react';
import type { FC } from 'react';
interface PlanStepsProps {
  steps: PlanStep[];
}
/** Plan steps display the model's persisted progress independently of editable Todos. */
export const PlanSteps: FC<PlanStepsProps> = ({ steps }) => {
  return (
    <div className="space-y-2">
      {steps.map((step) => {
        return (
          <div key={step.id} className="flex items-start gap-2 text-sm leading-6">
            {step.status === 'completed' && (
              <CheckCircle2
                width={16}
                height={16}
                className="mt-1 shrink-0 text-muted-foreground"
                aria-hidden
              />
            )}
            {step.status === 'in_progress' && (
              <CircleDot width={16} height={16} className="mt-1 shrink-0" aria-hidden />
            )}
            {step.status === 'pending' && (
              <Circle
                width={16}
                height={16}
                className="mt-1 shrink-0 text-muted-foreground"
                aria-hidden
              />
            )}
            <span className="min-w-0 break-words">{step.title}</span>
          </div>
        );
      })}
    </div>
  );
};
