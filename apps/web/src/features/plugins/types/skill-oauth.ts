export type SkillOAuthPage =
  | { type: 'launch'; target: 'plugin' | 'mcp'; id: string; name: string }
  | { type: 'result'; name: string; successful: boolean; message: string | null }
  | { type: 'invalid' };

export interface SkillOAuthPresentation {
  title: string;
  description: string;
  pending: boolean;
  successful: boolean;
}
