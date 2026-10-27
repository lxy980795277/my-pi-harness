import { useCallback, useEffect, useState } from 'react';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { createPluginAuthorizationLaunch } from '@/features/plugins/services/plugin-authorization';
import { createPluginAppAuthorizationLaunch } from '@/features/plugins/services/plugin-app-authorization';
import { skillOAuthPresentation } from '@/features/plugins/utils/skill-oauth';
import type { SkillOAuthPage, SkillOAuthPresentation } from '@/features/plugins/types/skill-oauth';

/** The launch document owns one bounded request and ignores results after its render is removed. */
export const useSkillOAuthPage = (
  page: SkillOAuthPage,
  ticket: string | null,
): { presentation: SkillOAuthPresentation; close: () => void } => {
  const [launch] = useState(() => {
    if (page.type !== 'launch') return null;
    if (page.target === 'mcp') return createPluginAppAuthorizationLaunch(page.id, ticket);
    return createPluginAuthorizationLaunch(page.id, ticket);
  });
  const operation = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        if (launch === null) return;
        const authorizationUrl = await launch.start();
        signal.throwIfAborted();
        window.location.replace(authorizationUrl);
      },
      [launch],
    ),
  );
  const { run } = operation;
  useEffect(() => {
    if (launch !== null) run();
  }, [launch, run]);
  const presentation = skillOAuthPresentation(page, operation.error);
  useEffect(() => {
    document.title = presentation.title;
  }, [presentation.title]);
  const close = useCallback((): void => {
    window.close();
  }, []);
  return { presentation, close };
};
