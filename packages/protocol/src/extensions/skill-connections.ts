import { Type, type Static } from 'typebox';

export type SkillConnectionAccount = Static<typeof SkillConnectionAccountSchema>;
export type SkillConnectionStatus = Static<typeof SkillConnectionStatusSchema>;
export type SkillOAuthStart = Static<typeof SkillOAuthStartSchema>;
export type SkillOAuthLaunchTicket = Static<typeof SkillOAuthLaunchTicketSchema>;

const object = { additionalProperties: false } as const;

/** Account details are public; OAuth tokens, clients and PKCE remain on the daemon. */
export const SkillConnectionAccountSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 1000 }),
    username: Type.String({ minLength: 1, maxLength: 1000 }),
    displayName: Type.Union([Type.String({ maxLength: 1000 }), Type.Null()]),
    avatarUrl: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
  },
  object,
);

/** A plugin owns one authorization, shared by its Skills and explicitly enabled Apps. */
export const SkillConnectionStatusSchema = Type.Object(
  {
    collectionId: Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' }),
    isConnected: Type.Boolean(),
    account: Type.Union([SkillConnectionAccountSchema, Type.Null()]),
  },
  object,
);

export const SkillOAuthStartSchema = Type.Object(
  { authorizationUrl: Type.String({ minLength: 1, maxLength: 16384 }) },
  object,
);

/** A short-lived launch capability opens OAuth in a browser without exposing login credentials. */
export const SkillOAuthLaunchTicketSchema = Type.Object(
  {
    launchUrl: Type.String({ minLength: 1, maxLength: 16384 }),
    expiresAt: Type.Integer({ minimum: 0 }),
  },
  object,
);
