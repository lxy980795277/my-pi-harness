import type { FC, ReactNode } from 'react';

import { ConnectionCard } from '@/features/runtime/components/connection-card';
import { useServiceReadiness } from '@/features/runtime/hooks/use-service-readiness';

interface ServiceGateProps {
  children: ReactNode;
}

/** Keeps authenticated clients outside the workspace until daemon protocol validation succeeds. */
export const ServiceGate: FC<ServiceGateProps> = ({ children }) => {
  const service = useServiceReadiness();

  if (service.status === 'ready') {
    return children;
  }

  return (
    <div
      className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground"
      data-testid="service-gate"
    >
      <div className="w-full max-w-lg">
        <ConnectionCard status={service.status} message={service.message} onRetry={service.retry} />
      </div>
    </div>
  );
};
