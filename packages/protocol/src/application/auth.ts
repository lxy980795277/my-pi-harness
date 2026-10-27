import { type Static, Type } from 'typebox';

export type AppUser = Static<typeof AppUserSchema>;
export type LoginMethod = Static<typeof LoginMethodSchema>;
export type LoginProvider = Static<typeof LoginProviderSchema>;
export type LoginSessionInfo = Static<typeof LoginSessionInfoSchema>;
export type AuthStatus = Static<typeof AuthStatusSchema>;
export type LoginFlowStatus = Static<typeof LoginFlowStatusSchema>;
export type LoginFlow = Static<typeof LoginFlowSchema>;
export type AuthFlow = Static<typeof AuthFlowSchema>;
export type PairingCodeResponse = Static<typeof PairingCodeResponseSchema>;

/** Public application identity; provider secrets and external subject IDs remain host-owned. */
export const AppUserSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 100 }),
    name: Type.String({ minLength: 1, maxLength: 200 }),
    avatarUrl: Type.Union([Type.String({ maxLength: 2048 }), Type.Null()]),
  },
  { additionalProperties: false },
);

/** A provider can expose different authorization grants to desktop and browser clients. */
export const LoginMethodSchema = Type.Union([Type.Literal('device'), Type.Literal('web')]);

/** Availability refers to local provider configuration, not upstream account authorization. */
export const LoginProviderSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 80 }),
    name: Type.String({ minLength: 1, maxLength: 100 }),
    available: Type.Boolean(),
    methods: Type.Array(LoginMethodSchema, { uniqueItems: true }),
  },
  { additionalProperties: false },
);

/** Public login metadata never contains the bearer token or its hash. */
export const LoginSessionInfoSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 100 }),
    providerId: Type.String({ minLength: 1, maxLength: 80 }),
    expiresAt: Type.Integer({ minimum: 0, maximum: 8_640_000_000_000_000 }),
  },
  { additionalProperties: false },
);

/** Local machine trust and application login are independent authorization requirements. */
export const AuthStatusSchema = Type.Object(
  {
    localAuthorized: Type.Boolean(),
    authenticated: Type.Boolean(),
    csrfToken: Type.Union([Type.String(), Type.Null()]),
    providers: Type.Array(LoginProviderSchema),
    profileBound: Type.Boolean(),
    user: Type.Union([AppUserSchema, Type.Null()]),
    session: Type.Union([LoginSessionInfoSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

/** Application login state is separate from model-provider authorization flows. */
export const LoginFlowStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
]);

/** The public deviceCode is a user verification code, never the private device_code. */
export const LoginFlowSchema = Type.Object(
  {
    id: Type.String({ pattern: '^login_[A-Za-z0-9_-]+$', maxLength: 100 }),
    providerId: Type.String({ minLength: 1, maxLength: 80 }),
    status: LoginFlowStatusSchema,
    url: Type.Union([Type.String({ maxLength: 2048 }), Type.Null()]),
    deviceCode: Type.Union([Type.String({ maxLength: 100 }), Type.Null()]),
    expiresAt: Type.Integer({ minimum: 0, maximum: 8_640_000_000_000_000 }),
    error: Type.Union([Type.String({ maxLength: 1000 }), Type.Null()]),
  },
  { additionalProperties: false },
);

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

/** An authorized desktop owner can request the browser pairing challenge. */
export const PairingCodeResponseSchema = Type.Object(
  { code: Type.String() },
  { additionalProperties: false },
);
