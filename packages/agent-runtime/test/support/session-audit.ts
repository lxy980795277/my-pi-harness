import { ToolSourceSchema } from '@my-pi-harness/protocol';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

const definition = Type.Object({
  name: Type.String(),
  description: Type.String(),
  parameters: Type.Record(Type.String(), Type.Unknown()),
});
const accepted = Type.Object({
  tools: Type.Array(definition),
  toolSources: Type.Array(
    Type.Object({ name: Type.String(), source: ToolSourceSchema, fingerprint: Type.String() }),
  ),
});
const loaded = Type.Object({
  tools: Type.Array(Type.Object({ definition, fingerprint: Type.String() })),
});

export function acceptedTools(input: unknown): Static<typeof accepted> {
  if (!Value.Check(accepted, input)) throw new Error('Missing accepted tool audit');
  return input;
}

export function loadedTools(input: unknown): Static<typeof loaded> {
  if (!Value.Check(loaded, input)) throw new Error('Missing loaded tool audit');
  return input;
}
