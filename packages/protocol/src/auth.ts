import { type Static, Type } from 'typebox';

/** Local application authorization is separate from model provider credentials. */
export const AuthStatusSchema = Type.Object(
  {
    authenticated: Type.Boolean(),
    csrfToken: Type.Union([Type.String(), Type.Null()]),
    githubConfigured: Type.Boolean(),
    identity: Type.Union([
      Type.Object(
        { name: Type.String(), avatarUrl: Type.Union([Type.String(), Type.Null()]) },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
export type AuthStatus = Static<typeof AuthStatusSchema>;

/** A login challenge contains user interaction, never an OAuth token. */
export const AuthFlowSchema = Type.Object(
  {
    id: Type.String(),
    providerId: Type.String(),
    status: Type.Union([
      Type.Literal('pending'),
      Type.Literal('completed'),
      Type.Literal('failed'),
      Type.Literal('cancelled'),
    ]),
    url: Type.Union([Type.String(), Type.Null()]),
    deviceCode: Type.Union([Type.String(), Type.Null()]),
    prompt: Type.Union([
      Type.Object(
        {
          id: Type.String(),
          message: Type.String(),
          secret: Type.Boolean(),
          type: Type.Union([
            Type.Literal('text'),
            Type.Literal('secret'),
            Type.Literal('select'),
            Type.Literal('manual_code'),
          ]),
          placeholder: Type.Optional(Type.String()),
          options: Type.Optional(
            Type.Array(
              Type.Object(
                {
                  id: Type.String(),
                  label: Type.String(),
                  description: Type.Optional(Type.String()),
                },
                { additionalProperties: false },
              ),
            ),
          ),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    message: Type.Union([Type.String(), Type.Null()]),
    error: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type AuthFlow = Static<typeof AuthFlowSchema>;

/** An authorized desktop owner can request the browser pairing challenge. */
export const PairingCodeResponseSchema = Type.Object(
  { code: Type.String() },
  { additionalProperties: false },
);
export type PairingCodeResponse = Static<typeof PairingCodeResponseSchema>;

/** A provider-authorized browser redirect carries no credentials. */
export const AuthUrlResponseSchema = Type.Object(
  { url: Type.String() },
  { additionalProperties: false },
);
export type AuthUrlResponse = Static<typeof AuthUrlResponseSchema>;
