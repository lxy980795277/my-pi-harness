import type { SessionSnapshot } from '@my-pi-harness/protocol';
import { Layers3 } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { DialogContent } from '@/components/ui/dialog/dialog-content';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { Notice } from '@/components/ui/notice';
import { Tabs } from '@/components/ui/tabs';
import { TabsList } from '@/components/ui/tabs/tabs-list';
import { TabsTrigger } from '@/components/ui/tabs/tabs-trigger';
import { TabsContent } from '@/components/ui/tabs/tabs-content';
import { CheckpointPanel } from '@/features/work/components/checkpoint-panel';
import { ContextPanel } from '@/features/work/components/context-panel';
import { PlanPanel } from '@/features/work/components/plan-panel';
import { QuestionCard } from '@/features/work/components/question-card';
import { useWork } from '@/features/work/hooks/use-work';
import { usageLabel } from '@/features/work/utils/work-view';
interface WorkPanelProps {
  session: SessionSnapshot;
}
/** Keeps the conversation uncluttered while surfacing active human questions immediately. */
export const WorkPanel: FC<WorkPanelProps> = ({ session }) => {
  const state = useWork(session);
  const work = state.query.data;
  return (
    <div className="shrink-0 space-y-2 px-6 pb-2">
      <Button
        type="button"
        variant="ghost"
        className="h-7 gap-2 px-1 text-xs text-muted-foreground"
        onClick={state.show}
        aria-label="上下文与工作状态"
      >
        <Layers3 width={14} height={14} aria-hidden />
        {usageLabel(work?.state.usage ?? null)}
        {work?.state.mode === 'plan' && <span>· Plan</span>}
        {work && work.state.todos.length > 0 && <span>· {work.state.todos.length} 个任务</span>}
      </Button>
      {work?.state.questions.map((question) => {
        return (
          <div key={question.id}>
            {question.status === 'pending' && (
              <QuestionCard question={question} onAnswer={state.answer} />
            )}
          </div>
        );
      })}
      <Dialog open={state.open} onOpenChange={state.setOpen}>
        <DialogContent className="max-w-3xl" aria-describedby={undefined}>
          <DialogTitle>上下文与工作状态</DialogTitle>
          {state.query.isPending && <Notice>正在加载工作状态…</Notice>}
          {state.query.isError && <Notice tone="error">{state.query.error.message}</Notice>}
          {work && (
            <Tabs value={state.tab} onValueChange={state.setTab}>
              <TabsList className="mb-4">
                <TabsTrigger value="context">上下文</TabsTrigger>
                <TabsTrigger value="plan">计划与任务</TabsTrigger>
                <TabsTrigger value="questions">提问记录</TabsTrigger>
                <TabsTrigger value="checkpoints">检查点</TabsTrigger>
              </TabsList>
              <TabsContent value="context">
                <ContextPanel
                  state={work.state}
                  workspaceId={session.session.workspaceId}
                  running={state.running}
                  onCommand={state.command}
                />
              </TabsContent>
              <TabsContent value="plan">
                <PlanPanel state={work.state} running={state.running} onPatch={state.patch} />
              </TabsContent>
              <TabsContent value="questions">
                <div className="space-y-3">
                  {work.state.questions.map((question) => {
                    return (
                      <QuestionCard key={question.id} question={question} onAnswer={state.answer} />
                    );
                  })}
                  {work.state.questions.length === 0 && <Notice>暂无提问记录</Notice>}
                </div>
              </TabsContent>
              <TabsContent value="checkpoints">
                <CheckpointPanel
                  work={work}
                  session={session}
                  running={state.running}
                  onCommand={state.command}
                />
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
