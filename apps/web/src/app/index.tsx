import { Box, CircleDot, Cpu, Moon, Sun } from 'lucide-react';
import type { FC } from 'react';

import { useTheme } from '@/app/hooks/use-theme.js';
import { Button } from '@/components/ui/button/index.js';
import { RuntimePage } from '@/features/runtime/components/runtime-page/index.js';

const THEME_LABELS = {
  light: '切换到深色主题',
  dark: '切换到浅色主题',
} as const;

/** Desktop workspace shell shared by the web browser and Electron renderer. */
export const App: FC = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="flex min-h-svh bg-background text-foreground" data-testid="workspace-shell">
      <aside
        className="sticky top-0 flex h-svh w-52 shrink-0 flex-col border-r border-border bg-muted max-md:w-44"
        aria-label="工作台导航"
      >
        <div className="flex h-16 items-center gap-3 border-b border-border px-4">
          <Box width={20} height={20} strokeWidth={1.5} className="text-primary" aria-hidden />
          <div className="space-y-1">
            <p className="text-xs font-semibold">My Pi Harness</p>
            <p className="font-mono text-[10px] text-muted-foreground">LOCAL WORKSPACE</p>
          </div>
        </div>
        <nav className="space-y-4 p-3">
          <p className="px-2 text-[11px] text-muted-foreground">工作台</p>
          <a
            href="#runtime"
            aria-current="page"
            className="flex h-8 items-center gap-2 rounded bg-secondary px-2 text-xs font-medium text-secondary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Cpu width={14} height={14} strokeWidth={1.5} aria-hidden />
            运行状态
          </a>
        </nav>
        <div className="mt-auto space-y-3 border-t border-border p-4">
          <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <CircleDot width={12} height={12} strokeWidth={1.5} aria-hidden />
            本机服务模式
          </p>
          <p className="text-[11px] leading-5 text-muted-foreground">
            服务运行在当前电脑，界面通过本机接口读取状态。
          </p>
        </div>
      </aside>

      <main id="runtime" className="min-w-0 flex-1">
        <div className="flex h-16 items-center justify-between border-b border-border px-6">
          <p className="text-xs text-muted-foreground">
            工作台
            <span className="mx-2" aria-hidden>
              /
            </span>
            <span className="text-foreground">运行状态</span>
          </p>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={THEME_LABELS[theme]}
            title={THEME_LABELS[theme]}
            data-testid="theme-toggle"
          >
            {theme === 'light' && <Moon width={14} height={14} strokeWidth={1.5} aria-hidden />}
            {theme === 'dark' && <Sun width={14} height={14} strokeWidth={1.5} aria-hidden />}
          </Button>
        </div>
        <RuntimePage />
      </main>
    </div>
  );
};
