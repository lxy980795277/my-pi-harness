import { Type, type Static } from 'typebox';
import { SkillResourceSchema, SkillScopeSchema, SkillSelectionSchema } from '../extensions/skills';

export type FrozenSkill = Static<typeof FrozenSkillSchema>;
export type SkillCandidate = Static<typeof SkillCandidateSchema>;

const object = { additionalProperties: false } as const;
const id = Type.String({ minLength: 1, maxLength: 160 });

/** Loaded instructions and resource identities can be stored in the private Run log. */
export const FrozenSkillSchema = Type.Object(
  {
    selection: SkillSelectionSchema,
    authorization: Type.Object(
      {
        skillEpoch: Type.Integer({ minimum: 0 }),
        pluginId: Type.Union([id, Type.Null()]),
        pluginEpoch: Type.Integer({ minimum: 0 }),
        pluginGeneration: Type.Union([Type.String(), Type.Null()]),
      },
      object,
    ),
    name: Type.String(),
    description: Type.String(),
    scope: SkillScopeSchema,
    source: Type.String(),
    content: Type.String({ maxLength: 131072 }),
    resourceDirectory: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
    gatewayUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
    resources: Type.Array(SkillResourceSchema, { maxItems: 256 }),
    allowedTools: Type.Array(Type.String(), { maxItems: 128 }),
  },
  object,
);

/** Accepted metadata binds an unloaded Skill without retaining its body or resources. */
export const SkillCandidateSchema = Type.Pick(FrozenSkillSchema, [
  'selection',
  'authorization',
  'name',
  'description',
  'scope',
  'source',
]);

export const SkillCandidatesSchema = Type.Array(SkillCandidateSchema, { maxItems: 512 });
