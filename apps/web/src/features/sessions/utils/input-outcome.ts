import { RequestError } from '@/services/base-request';

/** Only a parsed client rejection proves the input was not accepted; transport/server errors do not. */
export const isRejectedInput = (failure: unknown): boolean => {
  return failure instanceof RequestError && failure.status >= 400 && failure.status < 500;
};
