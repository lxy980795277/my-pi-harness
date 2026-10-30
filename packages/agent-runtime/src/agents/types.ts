import type {
  AgentLimits,
  AgentSettings,
  AgentTask,
  RunView,
  SessionSummary,
} from '@my-pi-harness/protocol';
import type { RunExecution } from '../runs/execution.js';
import type { AgentRequestScheduler } from './request-scheduler.js';

export interface AgentTree {
  rootRunId: string;
  settings: AgentSettings;
  scheduler: AgentRequestScheduler;
  nodes: Set<AgentNode>;
  writer: string | null;
  writes: Map<string, number>;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export interface AgentNode {
  run: RunView;
  session: SessionSummary;
  tree: AgentTree;
  parent: AgentNode | undefined;
  task: AgentTask | undefined;
  depth: number;
  limits: AgentLimits;
  controller: AbortController;
  execution: RunExecution | undefined;
  promise: Promise<void>;
  requests: Set<Promise<void>>;
  requestCount: number;
  closing: boolean;
  error: unknown;
}

export interface AgentTaskNode extends AgentNode {
  task: AgentTask;
  parent: AgentNode;
}
