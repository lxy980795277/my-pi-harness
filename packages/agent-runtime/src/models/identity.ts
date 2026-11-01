import type { StreamFn } from '@earendil-works/pi-agent-core';
import { PI_AI_VERSION, type ClientIdentity } from '@earendil-works/pi-ai';
import { APP_VERSION } from '@my-pi-harness/protocol';

const APPLICATION_IDENTITY: ClientIdentity = {
  userAgent: { custom: `my-pi-harness/${APP_VERSION} pi/${PI_AI_VERSION}` },
  attribution: null,
};

/** Apply the application's identity after Agent defaults for every leased model request. */
export function applicationStream(stream: StreamFn): StreamFn {
  return (model, context, options) =>
    stream(model, context, { ...options, identity: APPLICATION_IDENTITY });
}
