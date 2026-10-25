import type { SessionSnapshot } from '@my-pi-harness/protocol';
import type { FC, ReactNode } from 'react';
import { ConversationFooter } from '@/components/conversation-footer';
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
import type { WorkView } from '@/features/work/types/work';
interface WorkPanelProps {
  session: SessionSnapshot;
  state: WorkView;
  children?: ReactNode;
}
/** Keeps context controls below the composer and detailed work records in their dialog. */
export const WorkPanel: FC<WorkPanelProps> = ({ session, state, children }) => {
  const work = state.query.data;
  return (
    <>
      {children}
      <div className="shrink-0 px-5 pb-2 sm:px-6">
        <div className="mx-auto w-full max-w-4xl">
          <ConversationFooter
            contextLabel={state.contextLabel}
            conversationCount={state.conversationCount}
            onContext={state.show}
          />
        </div>
      </div>
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
                <TabsTrigger value="checkpoints">会话快照</TabsTrigger>
              </TabsList>
              <TabsContent value="context">
                <ContextPanel
                  work={work}
                  workspaceId={session.session.workspaceId}
                  running={state.running || state.query.isFetching}
                  onCommand={state.command}
                />
              </TabsContent>
              <TabsContent value="plan">
                <PlanPanel
                  state={work.state}
                  tools={session.tools}
                  running={state.running || state.query.isFetching}
                  onPatch={state.patch}
                />
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
                  running={state.running || state.query.isFetching}
                  onCommand={state.command}
                />
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
