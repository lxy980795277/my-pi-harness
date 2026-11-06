import { Type, type Static } from 'typebox';
import {
  completeToolRegistration,
  strictObjectSchema,
  ToolError,
  type ToolInvocation,
} from '../lib/tool-registry';

import type { Artifact } from '@my-pi-harness/protocol';

export type PublishArtifactInput = Static<typeof PublishArtifactParameters>;
export type PublishArtifactHandler = (
  input: PublishArtifactInput,
  invocation: ToolInvocation,
) => Promise<Artifact>;

const PublishArtifactParameters = strictObjectSchema({
  path: Type.String({ minLength: 1, maxLength: 2048 }),
  mediaType: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  producerCommandId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
});

/** Publication snapshots authorized bytes through the host-owned artifact service. */
export const publishArtifactTool = completeToolRegistration({
  name: 'publish_artifact',
  description:
    'Publish stable bytes of a workspace output as an immutable downloadable artifact. Optionally supply a successful managed producerCommandId from this task. Without it publication snapshots bytes but does not prove the producing job has finished.',
  parameters: PublishArtifactParameters,
  scope: 'workspace',
  loading: 'on-demand',
  readOnly: true,
  execute: async (ports, args, invocation) => {
    if (!ports.artifacts) throw new ToolError('ARTIFACT_UNAVAILABLE', '产物服务不可用。');
    const artifact = await ports.artifacts.publish(args, invocation);
    return {
      summary: `已发布 ${artifact.name}`,
      content: [{ type: 'text', text: JSON.stringify({ artifact }) }],
      artifacts: [artifact],
    };
  },
});
