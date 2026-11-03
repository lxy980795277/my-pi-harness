import type {
  AgentLimits,
  AgentSettings,
  AgentTask,
  RunView,
  SessionSummary,
} from '@my-pi-harness/protocol';
import type { RunExecution } from '../runs/execution.js';
import type { AgentRequestScheduler } from './request-scheduler.js';

export interface SubagentTree {
  rootRunId: string;
  settings: AgentSettings;
  scheduler: AgentRequestScheduler;
  nodes: Set<SubagentNode>;
  writer: string | null;
  writes: Map<string, number>;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export interface SubagentNode {
  run: RunView;
  session: SessionSummary;
  tree: SubagentTree;
  parent: SubagentNode | undefined;
  task: AgentTask | undefined;
  depth: number;
  limits: AgentLimits;
  controller: AbortController;
  execution: RunExecution | undefined;
  promise: Promise<void>;
  requests: Set<Promise<void>>;
  closing: boolean;
  error: unknown;
}

export interface SubagentTaskNode extends SubagentNode {
  task: AgentTask;
  parent: SubagentNode;
}
