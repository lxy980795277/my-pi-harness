import { Moon, Sun } from 'lucide-react';
import type { FC } from 'react';
import { useApplicationShell } from '@/app/hooks/use-application-shell';
import { WorkspaceNavigation } from '@/app/components/workspace-navigation';
import { ApplicationLoading } from '@/app/components/application-loading';
import { ApplicationInitializationError } from '@/app/components/application-initialization-error';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { LoginPage } from '@/features/auth/components/login-page';
import { PairingPage } from '@/features/auth/components/pairing-page';
import { RuntimePage } from '@/features/runtime/components/runtime-page';
import { SessionsPage } from '@/features/sessions/components/sessions-page';
import { SettingsDialog } from '@/features/settings/components/settings-dialog';
import { TaskHost } from '@/features/tasks/components/task-host';
import { TasksPage } from '@/features/tasks/components/tasks-page';
import { describeError } from '@/utils/describe-error';

/** Private application surfaces mount only after local trust and application login succeed. */
export const App: FC = () => {
  const state = useApplicationShell();
  if (state.auth.isPending || (state.checkingAuthorization && !state.auth.isError)) {
    return <ApplicationLoading stage="authorization" />;
  }
  if (state.auth.data === undefined || (state.auth.isError && !state.authorized)) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm space-y-4">
          <Notice tone="error">{describeError(state.auth.error)}</Notice>
          <Button type="button" onClick={state.reconnect}>
            重新连接
          </Button>
        </div>
      </div>
    );
  }
  if (!state.localAuthorized) {
    return (
      <div className="min-h-svh bg-background text-foreground">
        <PairingPage onPair={state.pair} />
      </div>
    );
  }
  if (!state.authorized) {
    return <LoginPage status={state.auth.data} onAuthenticated={state.receiveLogin} />;
  }
  if (state.initialization.state.status === 'loading') {
    return <ApplicationLoading stage={state.initialization.state.stage} />;
  }
  if (state.initialization.state.status === 'error') {
    return (
      <ApplicationInitializationError
        stage={state.initialization.state.stage}
        message={state.initialization.state.message}
        onRetry={state.initialization.retry}
      />
    );
  }
  return (
    <div className="flex h-svh min-h-0 bg-background text-foreground" data-testid="workspace-shell">
      <WorkspaceNavigation
        page={state.page}
        newConversation={state.newConversation}
        authorized={state.authorized}
        auth={state.auth.data}
        pairingCode={state.pairingCode}
        onNavigate={state.navigate}
        onNewConversation={state.startNewConversation}
        onSettings={state.settings}
        onPairing={state.pairing}
        onHideCode={state.hideCode}
        onLogout={state.signOut}
      />
      <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        {(state.newConversation || state.page === 'runtime') && (
          <div className="flex h-20 shrink-0 items-center justify-between px-7">
            <div className="space-y-1">
              <p className="text-sm font-semibold">{state.pageLabel}</p>
              {state.newConversation && (
                <p className="text-xs text-muted-foreground">开始一段全新的对话</p>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={state.toggleTheme}
              aria-label={state.themeLabel}
              title={state.themeLabel}
              data-testid="theme-toggle"
            >
              {state.theme === 'light' && <Moon width={14} height={14} aria-hidden />}
              {state.theme === 'dark' && <Sun width={14} height={14} aria-hidden />}
            </Button>
          </div>
        )}
        {state.actionError && (
          <div className="p-4">
            <Notice tone="error">{state.actionError}</Notice>
          </div>
        )}
        {state.page === 'runtime' && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <RuntimePage />
          </div>
        )}
        {state.page === 'tasks' && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <TasksPage />
          </div>
        )}
        {state.page === 'sessions' && (
          <div className="min-h-0 flex-1">
            <SessionsPage userName={state.userName} />
          </div>
        )}
      </main>
      {state.settingsOpen && (
        <SettingsDialog theme={state.theme} onToggleTheme={state.toggleTheme} />
      )}
      <TaskHost />
    </div>
  );
};
