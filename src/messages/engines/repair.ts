import type { UIMessage } from 'ai';

const TOOL_CALL_STATES = new Set(['input-streaming', 'input-available']);
const TOOL_RESULT_STATES = new Set(['output-available', 'output-error']);

interface ToolPartLike {
  type: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
}

function isToolPart(part: unknown): part is ToolPartLike {
  if (typeof part !== 'object' || part === null) return false;
  // SAFE? reading an optional field for a runtime shape check; the typeof
  // guard below decides, no properties are assumed present.
  const type = (part as ToolPartLike).type;
  return typeof type === 'string' && (type.startsWith('tool-') || type === 'dynamic-tool');
}

function callIdOf(part: ToolPartLike): string | null {
  return typeof part.toolCallId === 'string' ? part.toolCallId : null;
}

function isCallState(part: ToolPartLike): boolean {
  return callIdOf(part) !== null && part.state != null && TOOL_CALL_STATES.has(part.state);
}

function isResultState(part: ToolPartLike): boolean {
  return part.state != null && TOOL_RESULT_STATES.has(part.state);
}

function hasInput(part: ToolPartLike): boolean {
  return part.input != null;
}

export function repairUnresolvedToolCalls(messages: UIMessage[]): UIMessage[] {
  return messages.map((msg) => {
    if (msg.role !== 'assistant') return msg;
    const parts = msg.parts as unknown[];
    if (!parts.some((p) => isToolPart(p))) return msg;

    const resultCallIds = new Set<string>();
    // Any input found in the group, so every emitted tool call can carry
    // `arguments` - providers reject argument-less tool calls outright.
    const groupInputs = new Map<string, unknown>();
    for (const raw of parts) {
      if (!isToolPart(raw)) continue;
      const id = callIdOf(raw);
      if (id === null) continue;
      if (isResultState(raw)) resultCallIds.add(id);
      if (hasInput(raw) && !groupInputs.has(id)) groupInputs.set(id, raw.input);
    }
    const dropCallIds = new Set<string>();
    for (const raw of parts) {
      if (!isToolPart(raw) || !isCallState(raw) || hasInput(raw)) continue;
      const id = callIdOf(raw);
      if (id !== null && !resultCallIds.has(id)) dropCallIds.add(id);
    }

    let changed = false;
    const kept: unknown[] = [];
    const synthesized: unknown[] = [];
    for (const raw of parts) {
      if (!isToolPart(raw)) {
        kept.push(raw);
        continue;
      }
      const id = callIdOf(raw);
      if (id === null) {
        kept.push(raw);
        continue;
      }
      if (dropCallIds.has(id)) {
        changed = true;
        continue;
      }
      if (!hasInput(raw) && (isCallState(raw) || isResultState(raw))) {
        // The pair stays valid only if every part carries arguments.
        kept.push({ ...raw, input: groupInputs.get(id) ?? {} });
        changed = true;
        continue;
      }
      kept.push(raw);
      if (isCallState(raw) && !resultCallIds.has(id)) {
        synthesized.push({
          type: raw.type,
          toolCallId: id,
          state: 'output-error',
          input: groupInputs.get(id) ?? {},
          errorText: 'Tool result missing (recovered)',
        });
      }
    }

    if (!changed && synthesized.length === 0) return msg;
    const keptParts = kept as UIMessage['parts'];
    const extraParts = synthesized as UIMessage['parts'];
    return { ...msg, parts: [...keptParts, ...extraParts] };
  });
}
