import type { FC } from 'react';
import { Switch } from '@/components/ui/switch';
import { Markdown } from '@/components/markdown';
import { PluginIcon } from '@/features/plugins/components/plugin-icon';
import type { PluginSkillRow } from '@/features/plugins/types/plugin';

interface PluginSkillDetailProps {
  pluginId: string;
  skill: PluginSkillRow;
}

/** Installed instructions remain readable even when this plugin or component is disabled. */
export const PluginSkillDetail: FC<PluginSkillDetailProps> = ({ pluginId, skill }) => {
  return (
    <div className="space-y-8">
      <div className="flex items-start gap-4">
        <PluginIcon id={pluginId} large />
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold">{skill.name}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{skill.description}</p>
        </div>
        <Switch
          checked={skill.enabled}
          onCheckedChange={skill.change}
          disabled={skill.disabled}
          aria-label={`启用 ${skill.name} 技能`}
        />
      </div>
      <Markdown text={skill.content} />
    </div>
  );
};
