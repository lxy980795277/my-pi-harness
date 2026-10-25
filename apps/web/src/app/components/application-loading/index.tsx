import type { FC } from 'react';
import type { ApplicationLoadingStage } from '@/app/types/initialization';

import './index.css';

interface ApplicationLoadingProps {
  stage: ApplicationLoadingStage;
}

const STAGE_LABELS: Record<ApplicationLoadingStage, string> = {
  authorization: '正在检查登录状态',
  service: '正在连接本机服务',
  workspace: '正在准备工作台',
};

/** One stable loading surface spans authorization, service checks and initial workspace reads. */
export const ApplicationLoading: FC<ApplicationLoadingProps> = ({ stage }) => {
  return (
    <div
      className="application-loading"
      data-testid="application-loading"
      data-stage={stage}
      role="status"
      aria-live="polite"
    >
      <div className="application-loading__content">
        <div className="application-loading__graphic" aria-hidden="true">
          <span className="application-loading__glow" />
          <span className="application-loading__sculpture">
            <span className="application-loading__orbit application-loading__orbit--blue">
              <span className="application-loading__track" />
              <span className="application-loading__sweep" />
            </span>
            <span className="application-loading__orbit application-loading__orbit--violet">
              <span className="application-loading__track" />
              <span className="application-loading__sweep" />
            </span>
            <span className="application-loading__orbit application-loading__orbit--cyan">
              <span className="application-loading__track" />
              <span className="application-loading__sweep" />
            </span>
          </span>
          <span className="application-loading__shadow" />
        </div>
        <p className="application-loading__label">
          <span>{STAGE_LABELS[stage]}</span>
          <span className="application-loading__dots" aria-hidden="true">
            <span className="application-loading__dot" />
            <span className="application-loading__dot" />
            <span className="application-loading__dot" />
          </span>
        </p>
      </div>
    </div>
  );
};
