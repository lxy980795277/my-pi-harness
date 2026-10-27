import { type Static, Type } from 'typebox';

export type DaemonReadyRecord = Static<typeof DaemonReadyRecordSchema>;
export type DaemonControlMessage = Static<typeof DaemonControlMessageSchema>;
export type DesktopInfo = Static<typeof DesktopInfoSchema>;

/** Renderer 可调用的白名单桌面能力。 */
export interface DesktopBridge {
  /** 返回产品版本和平台。 */
  getInfo(): Promise<DesktopInfo>;
  /** Resolve a registered Skill on the host and reveal its directory; arbitrary paths are rejected. */
  revealSkillDirectory(skillId: string, workspaceId: string | null): Promise<void>;
  /** Open the URL of an active daemon-owned authentication flow. */
  openAuth(flowId: string): Promise<void>;
  /** Open an explicit HTTP(S) link in the system browser; other protocols are rejected. */
  openExternal(url: string): Promise<void>;
  /** Choose a local workspace directory; cancellation returns null. */
  chooseWorkspaceDirectory(): Promise<string | null>;
  /** Resolve one actual dropped directory; synthetic files and regular files are rejected. */
  getDroppedWorkspaceDirectory(file: unknown): Promise<string>;
}

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

/** 桌面所有者请求跨平台正常退出；只接受固定控制消息。 */
export const DaemonControlMessageSchema = Type.Object(
  { type: Type.Literal('daemon.shutdown') },
  { additionalProperties: false },
);

/** 桌面桥只返回公开元数据，不提供任意 IPC 或文件操作。 */
export const DesktopInfoSchema = Type.Object(
  {
    appVersion: Type.String({ minLength: 1 }),
    platform: Type.Union([Type.Literal('darwin'), Type.Literal('win32'), Type.Literal('linux')]),
  },
  { additionalProperties: false },
);
