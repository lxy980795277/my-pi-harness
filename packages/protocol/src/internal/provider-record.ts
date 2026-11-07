import { Type, type Static } from 'typebox';
import { ProviderConfigSchema } from '../application/models';

export type ProviderRecord = Static<typeof ProviderRecordSchema>;

/** Durable provider settings retain their opaque credential reference and existing stored status fields. */
export const ProviderRecordSchema = Type.Object(
  {
    ...ProviderConfigSchema.properties,
    credentialRef: Type.String({ minLength: 1, maxLength: 160 }),
  },
  { additionalProperties: false },
);
