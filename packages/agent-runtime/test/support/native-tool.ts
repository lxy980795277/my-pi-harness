import { vi, type Mock } from 'vitest';
import {
  nativeTool,
  type ToolInvocation,
  type ToolContext,
  type ToolResult,
} from '@my-pi-harness/tools';

type Execute = (
  args: Record<string, unknown>,
  invocation: ToolInvocation,
  ports: ToolContext,
) => Promise<ToolResult>;

/** Observe the executor selected by one registration while retaining its per-Run port binding. */
export function observeNativeTool(name: string): { execute: Mock<Execute>; restore(): void } {
  const registration = nativeTool(name);
  if (!registration) throw new Error(`Missing native tool ${name}`);
  const original = registration.bind.bind(registration);
  const execute = vi.fn<Execute>((args, invocation, ports) => original(ports)(args, invocation));
  const binding = vi
    .spyOn(registration, 'bind')
    .mockImplementation((ports) => (args, invocation) => execute(args, invocation, ports));
  return { execute, restore: () => binding.mockRestore() };
}
