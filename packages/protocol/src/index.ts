import { type Static, Type } from 'typebox';
export * from './context.js';

export {
  CustomProtocolSchema,
  ThinkingLevelSchema,
  CompatOptionsSchema,
  ModelDefinitionSchema,
  ModelInfoSchema,
  DefaultModelSchema,
  AppSettingsSchema,
  AppSettingsInputSchema,
  ProviderConfigSchema,
  ProviderInputSchema,
  NativeProviderInfoSchema,
  ConnectionResultSchema,
} from './models.js';
export type {
  CustomProtocol,
  ThinkingLevel,
  CompatOptions,
  ModelDefinition,
  ModelInfo,
  DefaultModel,
  AppSettings,
  AppSettingsInput,
  ProviderConfig,
  ProviderInput,
  NativeProviderInfo,
  ConnectionResult,
} from './models.js';
export {
  SessionSummarySchema,
  MessageViewSchema,
  RunViewSchema,
  QueueInputSchema,
  BranchViewSchema,
  SessionSnapshotSchema,
  HarnessEventSchema,
  SessionCreateInputSchema,
  ResolvedSessionCreateInputSchema,
  SessionPatchInputSchema,
  InputRequestSchema,
  EditInputSchema,
  QueuePatchInputSchema,
} from './sessions.js';
export type {
  SessionSummary,
  MessageView,
  RunView,
  QueueInput,
  BranchView,
  SessionSnapshot,
  HarnessEvent,
  SessionCreateInput,
  ResolvedSessionCreateInput,
  SessionPatchInput,
  InputRequest,
  EditInput,
  QueuePatchInput,
} from './sessions.js';
export {
  AuthStatusSchema,
  AuthFlowSchema,
  PairingCodeResponseSchema,
  AuthUrlResponseSchema,
} from './auth.js';
export type { AuthStatus, AuthFlow, PairingCodeResponse, AuthUrlResponse } from './auth.js';

export { APP_VERSION } from './version.js';
export {
  WORKSPACE_ICONS,
  WorkspaceIconSchema,
  WorkspaceSchema,
  WorkspaceCreateInputSchema,
  WorkspaceRenameInputSchema,
} from './workspaces.js';
export type {
  WorkspaceIcon,
  Workspace,
  WorkspaceCreateInput,
  WorkspaceRenameInput,
} from './workspaces.js';
export {
  ApprovalModeSchema,
  ToolApprovalSchema,
  ToolCallRecordSchema,
  ToolCallViewSchema,
  ToolDecisionInputSchema,
} from './tools.js';
export type {
  ApprovalMode,
  ToolApproval,
  ToolCallRecord,
  ToolCallView,
  ToolDecisionInput,
} from './tools.js';

/** 跨端应用协议版本；不等同于产品版本。 */
export const PROTOCOL_VERSION = 7;

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

export type HealthResponse = Static<typeof HealthResponseSchema>;

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

export type RuntimeReadyEvent = Static<typeof RuntimeReadyEventSchema>;

/** 桌面启动管道只用于确认本机服务已开始监听。 */
export const DaemonReadyRecordSchema = Type.Object(
  {
    type: Type.Literal('daemon.ready'),
    host: Type.Literal('127.0.0.1'),
    port: Type.Integer({ minimum: 1, maximum: 65535 }),
    instanceId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type DaemonReadyRecord = Static<typeof DaemonReadyRecordSchema>;

/** 桌面所有者请求跨平台正常退出；只接受固定控制消息。 */
export const DaemonControlMessageSchema = Type.Object(
  { type: Type.Literal('daemon.shutdown') },
  { additionalProperties: false },
);

export type DaemonControlMessage = Static<typeof DaemonControlMessageSchema>;

/** 桌面桥只返回公开元数据，不提供任意 IPC 或文件操作。 */
export const DesktopInfoSchema = Type.Object(
  {
    appVersion: Type.String({ minLength: 1 }),
    platform: Type.Union([Type.Literal('darwin'), Type.Literal('win32'), Type.Literal('linux')]),
  },
  { additionalProperties: false },
);

export type DesktopInfo = Static<typeof DesktopInfoSchema>;

/** Renderer 可调用的白名单桌面能力。 */
export interface DesktopBridge {
  /** 返回产品版本和平台。 */
  getInfo(): Promise<DesktopInfo>;
  /** Open the URL of an active daemon-owned authentication flow. */
  openAuth(flowId: string): Promise<void>;
  /** Choose a local workspace directory; cancellation returns null. */
  chooseWorkspaceDirectory(): Promise<string | null>;
  /** Resolve one actual dropped directory; synthetic files and regular files are rejected. */
  getDroppedWorkspaceDirectory(file: unknown): Promise<string>;
}
