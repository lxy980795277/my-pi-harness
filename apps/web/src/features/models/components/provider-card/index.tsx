import type { ProviderConfig } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Settings2, Boxes } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ProviderIcon } from '@/features/models/components/provider-icon';
import { useProviderCard } from '@/features/models/hooks/use-provider-card';

interface ProviderCardProps {
  provider: ProviderConfig;
  pending: boolean;
  onOpen: (id: string) => void;
  onModels: (id: string) => void;
  onToggle: (provider: ProviderConfig, enabled: boolean) => void;
}

/** Rounded public provider summary mirrors the settings catalog. */
export const ProviderCard: FC<ProviderCardProps> = ({
  provider,
  pending,
  onOpen,
  onModels,
  onToggle,
}) => {
  const state = useProviderCard(provider, onOpen, onModels, onToggle);
  return (
    <section className="space-y-4 rounded-2xl bg-muted/60 p-5" aria-label={provider.name}>
      <header className="flex items-center gap-3">
        <ProviderIcon providerId={provider.builtinId} />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{provider.name}</h3>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">{state.subtitle}</p>
        </div>
        <Badge>
          {provider.configured && '已配置'}
          {!provider.configured && '未配置'}
        </Badge>
        <Switch
          checked={provider.enabled}
          onCheckedChange={state.toggle}
          disabled={pending}
          aria-label={`启用 ${provider.name}`}
        />
      </header>
      <div className="flex flex-wrap gap-1.5">
        {state.visibleModels.map((model) => {
          return (
            <span
              key={model.id}
              className="max-w-full truncate rounded-md bg-background px-2 py-1 text-[10px] text-muted-foreground"
            >
              {model.name}
            </span>
          );
        })}
        {state.remainingModels > 0 && (
          <span className="rounded-md bg-background px-2 py-1 text-[10px] text-muted-foreground">
            +{state.remainingModels}
          </span>
        )}
        {provider.models.length === 0 && (
          <p className="text-xs text-muted-foreground">尚未添加模型</p>
        )}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">{state.authDescription}</p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="rounded-full bg-background"
            onClick={state.models}
          >
            <Boxes width={13} height={13} aria-hidden />
            模型
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-full bg-background"
            onClick={state.configure}
          >
            <Settings2 width={13} height={13} aria-hidden />
            配置
          </Button>
        </div>
      </footer>
    </section>
  );
};
