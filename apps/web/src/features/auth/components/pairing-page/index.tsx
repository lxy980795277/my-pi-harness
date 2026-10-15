import { ShieldCheck } from 'lucide-react';
import type { FC } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { usePairingForm } from '@/features/auth/hooks/use-pairing-form';

interface PairingPageProps {
  onPair: (code: string) => Promise<void>;
}

/** Exchanges the owner's one-time code; the code is never stored in Query or Store. */
export const PairingPage: FC<PairingPageProps> = ({ onPair }) => {
  const { code, pending, error, submit, change } = usePairingForm(onPair);

  return (
    <section className="mx-auto flex w-full max-w-lg flex-col gap-5 p-6 py-12">
      <div className="flex items-center gap-3">
        <ShieldCheck width={24} height={24} className="text-primary" aria-hidden />
        <div>
          <h1 className="text-lg font-semibold">连接你的本机工作台</h1>
          <p className="mt-1 text-xs leading-6 text-muted-foreground">
            首次浏览器访问需要由本机所有者授权。
          </p>
        </div>
      </div>
      <Notice>
        在启动 daemon 的终端查找一次性配对码，填入后建立当前浏览器的本机会话。
        桌面应用通过自己的启动链授权。配对码过期时请从本机服务重新获取。
      </Notice>
      <form className="space-y-4 rounded-lg border bg-card p-5" onSubmit={submit}>
        <Field label="一次性配对码" htmlFor="pairing-code">
          <Input
            id="pairing-code"
            name="pairing-code"
            type="password"
            autoComplete="off"
            value={code}
            disabled={pending}
            required
            onChange={change}
          />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" disabled={pending || code.trim().length === 0}>
          {pending && '正在授权…'}
          {!pending && '授权并进入'}
        </Button>
      </form>
    </section>
  );
};
