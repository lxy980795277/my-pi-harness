import type { NativeProviderInfo, ProviderConfig } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { DialogDescription } from '@/components/ui/dialog/dialog-description';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { SelectField } from '@/components/ui/select-field';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs } from '@/components/ui/tabs';
import { TabsList } from '@/components/ui/tabs/tabs-list';
import { TabsTrigger } from '@/components/ui/tabs/tabs-trigger';
import { OAuthFlowPanel } from '@/features/auth/components/oauth-flow-panel';
import { useProviderEditor } from '@/features/models/hooks/use-provider-editor';
import { useProviderEditorFields } from '@/features/models/hooks/use-provider-editor-fields';

interface ProviderEditorProps {
  provider: ProviderConfig | null;
  native: NativeProviderInfo | undefined;
  onClose: () => void;
}

/** Native configuration is limited to authentication; custom metadata stays in a private form draft. */
export const ProviderEditor: FC<ProviderEditorProps> = ({ provider, native, onClose }) => {
  const state = useProviderEditor(provider, native);
  const fields = useProviderEditorFields(state);
  return (
    <>
      <DialogTitle>{state.title}</DialogTitle>
      <DialogDescription>凭据仅保存在本机安全存储中。</DialogDescription>
      <form
        id="provider-configuration-form"
        className="space-y-5"
        aria-label="Provider 配置"
        onSubmit={state.submit}
      >
        {state.custom && (
          <div className="space-y-4">
            <Field label="名称" htmlFor="provider-name">
              <Input
                id="provider-name"
                value={state.name}
                onChange={fields.changeName}
                required
                maxLength={80}
              />
            </Field>
            <Field label="协议" htmlFor="provider-api">
              <SelectField
                id="provider-api"
                value={state.api}
                onValueChange={state.changeApi}
                options={fields.protocolOptions}
              />
            </Field>
            <Field label="Base URL" htmlFor="provider-base-url" description={state.apiHelp}>
              <Input
                id="provider-base-url"
                value={state.baseUrl}
                onChange={fields.changeBaseUrl}
                placeholder={fields.baseUrlPlaceholder}
                type="url"
                required
              />
            </Field>
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="provider-requires-key">需要 API Key</Label>
                <p className="mt-1 text-xs text-muted-foreground">本地模型服务可以关闭此选项。</p>
              </div>
              <Switch
                id="provider-requires-key"
                checked={state.requiresApiKey}
                onCheckedChange={state.changeRequiresKey}
              />
            </div>
          </div>
        )}
        {state.requiresApiKey && (
          <section className="space-y-4 rounded-xl bg-muted/60 p-4" aria-label="Provider 认证">
            {state.supportsOAuth && state.supportsApiKey && !state.storedMethod && (
              <Tabs value={state.method} onValueChange={state.changeMethod}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="api_key">API Key</TabsTrigger>
                  <TabsTrigger value="oauth">OAuth</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
            {state.storedMethod && (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">已保存认证</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {state.credentialPreview ?? 'OAuth 已登录'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={state.openCredentialRemoval}
                  disabled={state.busy}
                >
                  移除凭据
                </Button>
              </div>
            )}
            {state.supportsApiKey && !state.storedMethod && state.method === 'api_key' && (
              <Field
                label="API Key"
                htmlFor="provider-key"
                description="输入值提交后立即从表单清除。留空可保留已保存的凭据。"
              >
                <div className="flex gap-2">
                  <Input
                    id="provider-key"
                    type={state.inputType}
                    value={state.key}
                    onChange={fields.changeKey}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="显示或隐藏 API Key"
                    onClick={state.toggleKey}
                  >
                    {state.keyVisible && <EyeOff width={15} height={15} aria-hidden />}
                    {!state.keyVisible && <Eye width={15} height={15} aria-hidden />}
                  </Button>
                </div>
              </Field>
            )}
            {state.method === 'oauth' && !state.storedMethod && !state.oauthActive && (
              <Button
                type="button"
                variant="secondary"
                className="w-full rounded-full"
                onClick={state.startAuth}
                disabled={state.busy}
              >
                使用 OAuth 登录
              </Button>
            )}
          </section>
        )}
      </form>
      {state.oauthActive && state.flowId && (
        <OAuthFlowPanel flowId={state.flowId} onCompleted={state.complete} />
      )}
      <div className="space-y-4">
        {state.partialSaved && state.error && (
          <Notice>Provider 配置已保存。请重新输入凭据并保存；不会重复创建。</Notice>
        )}
        {state.error && <Notice tone="error">{state.error}</Notice>}
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <div>
            {provider?.kind === 'custom' && (
              <Button
                type="button"
                variant="ghost"
                onClick={state.openDelete}
                disabled={state.busy}
              >
                删除 Provider
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={state.busy}>
              取消
            </Button>
            {state.showSave && (
              <Button
                type="submit"
                form="provider-configuration-form"
                className="rounded-full"
                disabled={state.saveDisabled}
              >
                保存
              </Button>
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={state.confirmCredential}
        onOpenChange={state.setConfirmCredential}
        title="移除凭据"
        description="移除后可重新输入 API Key 或选择其他登录方式。已有运行保留启动时的认证。"
        confirmLabel="确认移除"
        pending={state.busy}
        onConfirm={state.removeCredential}
        error={state.error}
      />
      <ConfirmDialog
        open={state.confirmDelete}
        onOpenChange={state.setConfirmDelete}
        title="删除 Provider"
        description="删除后历史会话保留，引用此 Provider 的新运行将无法启动。"
        confirmLabel="确认删除"
        pending={state.busy}
        onConfirm={state.remove}
        error={state.error}
      />
    </>
  );
};
