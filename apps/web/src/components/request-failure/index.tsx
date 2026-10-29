import type { FC } from 'react';

interface RequestFailureProps {
  text: string;
}

/** Request diagnostics stay readable beside their partial answer and never execute Markdown. */
export const RequestFailure: FC<RequestFailureProps> = ({ text }) => {
  return (
    <p
      className="text-xs leading-5 [overflow-wrap:anywhere] whitespace-pre-wrap text-error-solid"
      role="status"
    >
      {text}
    </p>
  );
};
