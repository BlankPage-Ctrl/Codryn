import type { MessagePartRow, RunStepRow } from '../../../src/messages/index.js';
import type { FeedHistoryEvent } from './feed-events.js';

export interface ReplayMessage {
  id: string;
  role: string;
  parts: MessagePartRow[];
  steps: RunStepRow[];
}

function safeJson(value: string | null): unknown {
  if (value == null) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

interface Scope {
  chatId: string;
  messageId: string;
  role: string;
  runId?: string;
  at: number;
}

export function replayHistory(
  thread: ReplayMessage[],
  ctx: { chatId: string; at?: number },
): FeedHistoryEvent[] {
  const at = ctx.at ?? Date.now();
  const events: FeedHistoryEvent[] = [];
  for (const msg of thread) {
    const runId = msg.steps.length > 0 ? msg.steps[msg.steps.length - 1].runId : undefined;
    const scope: Scope = { chatId: ctx.chatId, messageId: msg.id, role: msg.role, at };
    if (runId !== undefined) scope.runId = runId;

    let stage = 0;
    for (const part of msg.parts) {
      if (part.isSystem) continue;
      switch (part.type) {
        case 'text': {
          const text = part.text ?? '';
          if (text === '') break;
          events.push({ type: 'text-open', ...scope, sliceId: part.id });
          events.push({ type: 'text-delta', ...scope, sliceId: part.id, delta: text });
          events.push({ type: 'text-close', ...scope, sliceId: part.id });
          break;
        }

        case 'reasoning': {
          const text = part.text ?? '';
          if (text === '') break;
          events.push({ type: 'think-open', ...scope, sliceId: part.id });
          events.push({ type: 'think-delta', ...scope, sliceId: part.id, delta: text });
          events.push({ type: 'think-close', ...scope, sliceId: part.id });
          break;
        }

        case 'step-start':
          events.push({ type: 'stage-open', ...scope, stage: stage++ });
          break;

        case 'dynamic-tool':
        case 'file':
        case 'reasoning-file':
        case 'source-url':
        case 'source-document':
          pushAsset(events, scope, part);
          break;

        default: {
          if (part.type.startsWith('tool-')) {
            pushWork(events, scope, part);
          }
          break;
        }
      }
    }

    for (const step of msg.steps) {
      events.push({
        type: 'stage-close',
        ...scope,
        stage: step.stepIndex,
        landed: step.finishReason ?? 'unknown',
        ...(step.inputTokens != null ? { inputTokens: step.inputTokens } : {}),
        ...(step.outputTokens != null ? { outputTokens: step.outputTokens } : {}),
        ...(step.totalTokens != null ? { totalTokens: step.totalTokens } : {}),
      });
    }
  }
  return events;
}

function pushAsset(events: FeedHistoryEvent[], scope: Scope, part: MessagePartRow): void {
  switch (part.type) {
    case 'source-url':
      events.push({
        type: 'asset',
        ...scope,
        sliceId: part.id,
        kind: 'link',
        ...(part.url != null ? { url: part.url } : {}),
        ...(part.title != null ? { title: part.title } : {}),
      });
      break;

    case 'source-document':
      events.push({
        type: 'asset',
        ...scope,
        sliceId: part.id,
        kind: 'doc',
        ...(part.title != null ? { title: part.title } : {}),
        ...(part.mediaType != null ? { mediaType: part.mediaType } : {}),
        ...(part.filename != null ? { filename: part.filename } : {}),
      });
      break;

    case 'file':
    case 'reasoning-file':
      events.push({
        type: 'asset',
        ...scope,
        sliceId: part.id,
        kind: 'blob',
        ...(part.url != null ? { url: part.url } : {}),
        ...(part.mediaType != null ? { mediaType: part.mediaType } : {}),
      });
      break;

    default:
      break;
  }
}

function pushWork(events: FeedHistoryEvent[], scope: Scope, part: MessagePartRow): void {
  const implement = part.type === 'dynamic-tool' ? 'dynamic' : part.type.slice('tool-'.length);
  const callId = part.toolCallId ?? part.id;
  const input = safeJson(part.inputJson);
  const queued = {
    ...scope,
    sliceId: part.id,
    callId,
    implement,
  };
  events.push({ type: 'work-queued', ...queued });
  events.push({ type: 'work-active', ...queued, input });

  if (part.state === 'output-available') {
    events.push({ type: 'work-ok', ...queued, input, output: safeJson(part.outputJson) });
  } else if (part.state === 'output-error') {
    events.push({
      type: 'work-bad',
      ...queued,
      input,
      errorText: part.errorText ?? 'Unknown tool error',
    });
  }

  if (part.dataJson != null) {
    events.push({
      type: 'notice',
      ...scope,
      sliceId: `${part.id}:rich`,
      callId,
      implement,
      body: safeJson(part.dataJson),
    });
  }
}
