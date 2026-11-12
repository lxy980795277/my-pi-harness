import type { FC } from 'react';
import { Globe, ExternalLink, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { useWebSearchSettings } from '@/features/web-search/hooks/use-web-search-settings';

/** One official service key supplies web search and Markdown page retrieval. */
export const WebSearchSettings: FC = () => {
  const state = useWebSearchSettings();
  return (
    <div className="space-y-6 p-8">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">联网搜索</h2>
        <p className="text-xs leading-5 text-muted-foreground">
          网页搜索与正文读取共用 DeepSeek 官方服务，独立于对话模型配置。
        </p>
      </div>
      <div className="space-y-6 rounded-2xl border border-border p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
            <Globe width={20} height={20} strokeWidth={1.5} aria-hidden />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="text-sm font-medium">DeepSeek Search</h3>
            <p className="text-xs text-muted-foreground" role="status">
              {state.statusLabel}
            </p>
          </div>
          <Button variant="ghost" asChild>
            <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">
              获取 API Key
              <ExternalLink width={13} height={13} aria-hidden />
            </a>
          </Button>
        </div>
        <form onSubmit={state.submit} className="space-y-3">
          <Label htmlFor="deepseek-web-key" className="flex items-center gap-2">
            <KeyRound width={14} height={14} aria-hidden />
            API Key
          </Label>
          <Input
            id="deepseek-web-key"
            type="password"
            autoComplete="new-password"
            placeholder="输入 DeepSeek 官方 API Key"
            maxLength={4096}
            value={state.key}
            onChange={state.changeKey}
            disabled={state.busy}
            aria-describedby="deepseek-web-key-help"
            className="h-10 rounded-lg"
          />
          <p id="deepseek-web-key-help" className="text-xs leading-5 text-muted-foreground">
            凭据保存在本机，保存后不再显示。搜索与网页读取按 DeepSeek 服务规则计费。
          </p>
          <div className="flex items-center justify-end gap-2 pt-2">
            {state.configured && (
              <Button
                type="button"
                variant="ghost"
                onClick={state.remove}
                disabled={state.removeDisabled}
              >
                移除 Key
              </Button>
            )}
            <Button type="submit" disabled={state.saveDisabled}>
              {state.busy && '处理中…'}
              {!state.busy && '保存 API Key'}
            </Button>
          </div>
        </form>
      </div>
      {state.status.isError && (
        <div className="space-y-2">
          <Notice tone="error">{state.status.error.message}</Notice>
          <Button type="button" variant="outline" onClick={state.refresh}>
            重新读取
          </Button>
        </div>
      )}
      {state.feedback && <Notice tone="success">{state.feedback}</Notice>}
      {state.error && <Notice tone="error">{state.error}</Notice>}
    </div>
  );
};
