import { useCallback, type FC } from 'react';
import { Button } from '@/components/ui/button';
interface QuestionOptionProps {
  value: string;
  selected: boolean;
  disabled: boolean;
  onSelect: (value: string) => void;
}
/** Options populate the answer form so users can review or supplement their response. */
export const QuestionOption: FC<QuestionOptionProps> = ({
  value,
  selected,
  disabled,
  onSelect,
}) => {
  const select = useCallback((): void => {
    onSelect(value);
  }, [onSelect, value]);
  let variant: 'default' | 'outline' = 'outline';
  if (selected) {
    variant = 'default';
  }
  return (
    <Button
      type="button"
      variant={variant}
      className="h-auto min-h-8 justify-start whitespace-normal"
      disabled={disabled}
      onClick={select}
      aria-pressed={selected}
    >
      {value}
    </Button>
  );
};
