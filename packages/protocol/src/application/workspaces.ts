import { type Static, Type } from 'typebox';

export type WorkspaceIcon = Static<typeof WorkspaceIconSchema>;
export type Workspace = Static<typeof WorkspaceSchema>;
export type WorkspaceCreateInput = Static<typeof WorkspaceCreateInputSchema>;
export type WorkspaceRenameInput = Static<typeof WorkspaceRenameInputSchema>;

const name = Type.String({ minLength: 1, maxLength: 120 });

/** Stable workspace icon IDs; presentation maps these to the bundled Lucide icons. */
export const WORKSPACE_ICONS = [
  'folder',
  'code',
  'terminal',
  'book',
  'notebook',
  'briefcase',
  'chart',
  'flask',
  'globe',
  'palette',
  'music',
  'gamepad',
  'cpu',
  'database',
  'graduation-cap',
  'heart',
  'wrench',
  'rocket',
] as const;

export const WorkspaceIconSchema = Type.Enum(WORKSPACE_ICONS);

/** A registered local directory; removing its entry never removes files. */
export const WorkspaceSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 160 }),
    name,
    icon: WorkspaceIconSchema,
    rootPath: Type.String({ minLength: 1, maxLength: 4096 }),
    revision: Type.Integer({ minimum: 1 }),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

/** The daemon canonicalizes an existing absolute directory before registration. */
export const WorkspaceCreateInputSchema = Type.Object(
  {
    name: Type.Optional(name),
    icon: Type.Optional(WorkspaceIconSchema),
    rootPath: Type.String({ minLength: 1, maxLength: 4096 }),
  },
  { additionalProperties: false },
);

/** Name and icon updates leave the registered directory and existing sessions unchanged. */
export const WorkspaceRenameInputSchema = Type.Object(
  {
    name,
    icon: Type.Optional(WorkspaceIconSchema),
    expectedRevision: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
