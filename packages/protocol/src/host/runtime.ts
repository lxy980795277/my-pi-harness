import { type Static, Type } from 'typebox';

export type HealthResponse = Static<typeof HealthResponseSchema>;
export type RuntimeReadyEvent = Static<typeof RuntimeReadyEventSchema>;

/** 跨端应用协议版本；不等同于产品版本。 */
export const PROTOCOL_VERSION = 22;

/** 本机服务完成监听后的可公开状态，不包含配置、路径或凭据。 */
export const HealthResponseSchema = Type.Object(
  {
    status: Type.Literal('ready'),
    appVersion: Type.String({ minLength: 1 }),
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    instanceId: Type.String({ minLength: 1 }),
    startedAt: Type.Integer({ minimum: 0, maximum: 8_640_000_000_000_000 }),
    nodeVersion: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

/** SSE 连接建立后的服务身份；前端据此识别重启。 */
export const RuntimeReadyEventSchema = Type.Object(
  {
    type: Type.Literal('runtime.ready'),
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    instanceId: Type.String({ minLength: 1 }),
    startedAt: Type.Integer({ minimum: 0, maximum: 8_640_000_000_000_000 }),
  },
  { additionalProperties: false },
);
