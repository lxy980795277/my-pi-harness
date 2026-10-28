import type { SelectOption } from '@/components/ui/select-field';

export interface ModelMenuOption extends SelectOption {
  name: string;
}

export interface ModelMenuGroup {
  id: string;
  name: string;
  builtinId: string | null;
  options: ModelMenuOption[];
}

export interface ModelMenuPresentation {
  label: string;
  builtinId: string | null;
  thinkingLabel: string;
  thinkingOptions: SelectOption[];
}
