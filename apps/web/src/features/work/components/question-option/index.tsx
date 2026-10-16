import type { QuestionOption as Option } from '@my-pi-harness/protocol';
import { Check, Circle } from 'lucide-react';
import { useCallback, type FC } from 'react';
import { Button } from '@/components/ui/button';
interface QuestionOptionProps {
  option: Option;
  selected: boolean;
  disabled: boolean;
  onSelect: (value: string) => void;
}
/** A whole option is keyboard reachable, including its explanatory text. */
export const QuestionOption: FC<QuestionOptionProps> = ({
  option,
  selected,
  disabled,
  onSelect,
}) => {
  const select = useCallback((): void => {
    onSelect(option.id);
  }, [onSelect, option.id]);
  let className = 'h-auto min-h-9 w-full justify-start gap-2 px-3 py-2 text-left whitespace-normal';
  if (selected) {
    className += ' bg-accent text-accent-foreground';
  }
  return (
    <Button
      type="button"
      variant="ghost"
      className={className}
      disabled={disabled}
      onClick={select}
      aria-pressed={selected}
    >
      {selected && <Check width={16} height={16} className="shrink-0" aria-hidden />}
      {!selected && (
        <Circle width={16} height={16} className="shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className="min-w-0 space-y-0.5">
        <span className="block text-sm">{option.label}</span>
        {option.description && (
          <span className="block text-xs font-normal text-muted-foreground">
            {option.description}
          </span>
        )}
      </span>
    </Button>
  );
};
