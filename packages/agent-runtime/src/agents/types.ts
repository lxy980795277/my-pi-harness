import type {
  AgentLimits,
  AgentSettings,
  AgentTask,
  RunView,
  SessionSummary,
} from '@my-pi-harness/protocol';
import type { RunExecution } from '../runs/execution.js';
import type { AgentBudget } from './budget.js';

export interface AgentTree {
  rootRunId: string;
  settings: AgentSettings;
  budget: AgentBudget;
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
