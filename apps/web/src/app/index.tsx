import { Moon, Sun } from 'lucide-react';
import type { FC } from 'react';
import { useApplicationShell } from '@/app/hooks/use-application-shell';
import { WorkspaceNavigation } from '@/app/components/workspace-navigation';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { AuthFlowWorkspace } from '@/features/auth/components/auth-flow-workspace';
import { PairingPage } from '@/features/auth/components/pairing-page';
import { RuntimePage } from '@/features/runtime/components/runtime-page';
import { SessionsPage } from '@/features/sessions/components/sessions-page';
import { SettingsDialog } from '@/features/settings/components/settings-dialog';
import { describeError } from '@/utils/describe-error';

/** Browser and desktop share the same locally authorized workspace. */
export const App: FC = () => {
  const state = useApplicationShell();
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
        onGithub={state.github}
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
        {state.authorized && <AuthFlowWorkspace />}
        {state.page === 'runtime' && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <RuntimePage />
          </div>
        )}
        {state.page !== 'runtime' && state.auth.isPending && (
          <div className="p-6">
            <Notice>正在检查本机授权…</Notice>
          </div>
        )}
        {state.page !== 'runtime' && state.auth.isError && (
          <div className="space-y-3 p-6">
            <Notice tone="error">{describeError(state.auth.error)}</Notice>
            <Button type="button" onClick={state.reconnect}>
              重新连接
            </Button>
          </div>
        )}
        {state.page !== 'runtime' && state.auth.isSuccess && !state.authorized && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PairingPage onPair={state.pair} />
          </div>
        )}
        {state.page === 'sessions' && state.authorized && (
          <div className="min-h-0 flex-1">
            <SessionsPage userName={state.userName} />
          </div>
        )}
      </main>
      {state.authorized && state.settingsOpen && (
        <SettingsDialog theme={state.theme} onToggleTheme={state.toggleTheme} />
      )}
    </div>
  );
};
