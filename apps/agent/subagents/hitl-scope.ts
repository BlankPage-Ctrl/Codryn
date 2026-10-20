import { AsyncLocalStorage } from 'node:async_hooks';
import type { AgentTool, AgentToolExecuteOptions } from '../../../src/agent/index.js';
import type {
  HitlRequestInput,
  HitlResponse,
  IHitlService,
} from '../../../src/human-in-the-loop/index.js';

/**
 * Provenance of a HITL request raised by a sub-agent. The parent run and the
 * delegate tool call identify the child, so the same request can be shown in
 * the parent chat and in the sub-agent tab.
 */
export interface HitlSubAgentScope {
  parentRunId: string;
  toolCallId: string;
  agentName: string;
  title: string;
}

export const SUB_AGENT_METADATA_KEYS = {
  toolCallId: 'subAgentToolCallId',
  parentRunId: 'subAgentParentRunId',
  agentName: 'subAgentName',
  title: 'subAgentTitle',
} as const;

const scopeStorage = new AsyncLocalStorage<HitlSubAgentScope>();

export function runWithHitlScope<T>(scope: HitlSubAgentScope, fn: () => T): T {
  return scopeStorage.run(scope, fn);
}

export function currentHitlScope(): HitlSubAgentScope | undefined {
  return scopeStorage.getStore();
}

export function subAgentScopeMetadata(scope: HitlSubAgentScope): Record<string, string> {
  return {
    [SUB_AGENT_METADATA_KEYS.toolCallId]: scope.toolCallId,
    [SUB_AGENT_METADATA_KEYS.parentRunId]: scope.parentRunId,
    [SUB_AGENT_METADATA_KEYS.agentName]: scope.agentName,
    [SUB_AGENT_METADATA_KEYS.title]: scope.title,
  };
}

/** Reads the sub-agent provenance of a stored request, when a child raised it. */
export function subAgentScopeFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): HitlSubAgentScope | null {
  if (!metadata) return null;
  const toolCallId = metadata[SUB_AGENT_METADATA_KEYS.toolCallId];
  if (typeof toolCallId !== 'string' || !toolCallId) return null;
  const parentRunId = metadata[SUB_AGENT_METADATA_KEYS.parentRunId];
  const agentName = metadata[SUB_AGENT_METADATA_KEYS.agentName];
  const title = metadata[SUB_AGENT_METADATA_KEYS.title];
  return {
    toolCallId,
    parentRunId: typeof parentRunId === 'string' ? parentRunId : '',
    agentName: typeof agentName === 'string' ? agentName : '',
    title: typeof title === 'string' ? title : '',
  };
}

/**
 * Adds the ambient sub-agent provenance to every request the service creates.
 * The scope is installed right before a child tool runs, so a request raised
 * by the parent run stays unscoped.
 */
export function scopeAwareHitlService(service: IHitlService): IHitlService {
  const withScope = (input: HitlRequestInput): HitlRequestInput => {
    const scope = currentHitlScope();
    if (!scope) return input;
    return {
      ...input,
      metadata: { ...input.metadata, ...subAgentScopeMetadata(scope) },
    };
  };

  return {
    request: (input) => service.request(withScope(input)),
    requestAndWait: (input) => service.requestAndWait(withScope(input)),
    submitResponse: (id: string, response: HitlResponse) => service.submitResponse(id, response),
    cancel: (id: string) => service.cancel(id),
    getById: (id: string) => service.getById(id),
    listPending: () => service.listPending(),
    events: service.events,
  };
}

/**
 * Runs a child tool with the sub-agent scope installed, so every HITL request
 * it raises (tool permission or an explicit question) is attributed to it.
 */
export function withSubAgentHitlScope(tool: AgentTool, scope: HitlSubAgentScope): AgentTool {
  return {
    ...tool,
    execute: (args, options?: AgentToolExecuteOptions) =>
      runWithHitlScope(scope, () => tool.execute(args, options)),
  };
}

export interface CancelSubAgentHitlResult {
  cancelled: number;
  failures: number;
}

/**
 * Cancels the pending requests a sub-agent raised. Used when the child dies
 * or is killed, so no card is left waiting for a human that will never come.
 */
export async function cancelSubAgentHitl(
  hitl: Pick<IHitlService, 'listPending' | 'cancel'>,
  matches: (scope: HitlSubAgentScope) => boolean,
): Promise<CancelSubAgentHitlResult> {
  const pending = await hitl.listPending();
  let cancelled = 0;
  let failures = 0;
  for (const request of pending) {
    const owner = subAgentScopeFromMetadata(request.metadata);
    if (!owner || !matches(owner)) continue;
    try {
      await hitl.cancel(request.id);
      cancelled += 1;
    } catch {
      // The request was answered or expired in the meantime.
      failures += 1;
    }
  }
  return { cancelled, failures };
}
