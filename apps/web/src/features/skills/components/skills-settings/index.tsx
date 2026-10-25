import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { SelectField } from '@/components/ui/select-field';
import { useSkillsSettings } from '@/features/skills/hooks/use-skills-settings';

/** Skill management keeps instruction contents separate from catalog metadata. */
export const SkillsSettings: FC = () => {
  const state = useSkillsSettings();
  return (
    <div className="space-y-5 p-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Skills</h2>
        <div className="flex gap-2">
          <Button onClick={state.create} disabled={state.pending}>
            创建 Skill
          </Button>
          <Button variant="outline" onClick={state.install} disabled={state.pending}>
            从 GitHub 安装
          </Button>
        </div>
      </div>
      <SelectField
        id="skills-scope"
        ariaLabel="Skills 作用域"
        value={state.workspace}
        options={state.workspaceOptions}
        onValueChange={state.changeWorkspace}
        disabled={state.pending}
      />
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {state.catalog.error && <Notice tone="error">{state.catalog.error.message}</Notice>}
      {state.mode !== 'closed' && (
        <div className="space-y-3 rounded-xl border border-border p-4">
          {state.mode === 'create' && (
            <>
              <Label htmlFor="skill-name">名称</Label>
              <Input
                id="skill-name"
                name="name"
                value={state.draft.name}
                onChange={state.changeField}
                placeholder="my-skill"
              />
              <Label htmlFor="skill-description">描述</Label>
              <Input
                id="skill-description"
                name="description"
                value={state.draft.description}
                onChange={state.changeField}
              />
              <Label htmlFor="skill-content">指令</Label>
              <Textarea
                id="skill-content"
                name="content"
                value={state.draft.content}
                onChange={state.changeField}
                className="min-h-40"
              />
            </>
          )}
          {state.mode === 'install' && (
            <>
              <Label htmlFor="skill-owner">GitHub 用户或组织</Label>
              <Input
                id="skill-owner"
                name="owner"
                value={state.draft.owner}
                onChange={state.changeField}
              />
              <Label htmlFor="skill-repository">仓库</Label>
              <Input
                id="skill-repository"
                name="repository"
                value={state.draft.repository}
                onChange={state.changeField}
              />
              <Label htmlFor="skill-ref">分支、标签或提交</Label>
              <Input
                id="skill-ref"
                name="ref"
                value={state.draft.ref}
                onChange={state.changeField}
              />
              <Label htmlFor="skill-path">Skill 目录</Label>
              <Input
                id="skill-path"
                name="path"
                value={state.draft.path}
                onChange={state.changeField}
                placeholder="skills/my-skill"
              />
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={state.closeForm}>
              取消
            </Button>
            <Button onClick={state.save} disabled={state.pending}>
              保存
            </Button>
          </div>
        </div>
      )}
      {state.rows.map((row) => {
        return (
          <div key={row.skill.id} className="rounded-xl border border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <Button
                variant="ghost"
                onClick={row.show}
                className="h-auto p-0 text-left whitespace-normal"
              >
                <span>
                  <span className="block font-medium">{row.skill.name}</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {row.skill.description}
                  </span>
                </span>
              </Button>
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" onClick={row.directory} disabled={state.pending}>
                  {state.directoryLabel}
                </Button>
                {row.canToggle && (
                  <Button variant="outline" onClick={row.toggle} disabled={state.pending}>
                    {row.skill.enabled && '停用'}
                    {!row.skill.enabled && '启用'}
                  </Button>
                )}
                {row.canRemove && (
                  <Button variant="ghost" onClick={row.remove} disabled={state.pending}>
                    卸载
                  </Button>
                )}
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {row.skill.scope} · {row.skill.resourceCount} 个资源
              {row.skill.shadowed && ' · 已被同名项覆盖'}
            </p>
          </div>
        );
      })}
      {state.detail.data && (
        <div className="space-y-3 rounded-xl bg-muted/50 p-4">
          <h3 className="font-medium">{state.detail.data.name}</h3>
          <pre className="text-xs leading-6 whitespace-pre-wrap">{state.detail.data.content}</pre>
          {state.resources.map((resource) => {
            return (
              <Button
                variant="ghost"
                onClick={resource.open}
                disabled={state.pending}
                key={resource.path}
                className="text-xs text-muted-foreground"
              >
                {resource.path} · {resource.size} bytes
              </Button>
            );
          })}
        </div>
      )}
      {state.resourceText !== null && (
        <pre className="rounded-xl bg-muted p-4 text-xs leading-6 whitespace-pre-wrap">
          {state.resourceText}
        </pre>
      )}
      {state.resourceImage !== null && (
        <img src={state.resourceImage} alt="Skill 资源预览" className="max-w-full" />
      )}
    </div>
  );
};
