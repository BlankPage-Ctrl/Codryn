import type { TextStreamPart, ToolSet } from 'ai';
import type { ChatFeedEventMap, ChatFeedEventName } from './feed-events.js';
import { mapAiError } from '../ai-errors/index.js';

export interface FeedMapCtx {
  runId: string;
  chatId: string;
  messageId: string;
  /** Current stage index, used for `stage-open`. Owned by the caller. */
  stage: number;
  at?: number;
}

export interface FeedDraft<K extends ChatFeedEventName = ChatFeedEventName> {
  name: K;
  payload: ChatFeedEventMap[K];
}

function now(ctx: FeedMapCtx): number {
  return ctx.at ?? Date.now();
}

function base(ctx: FeedMapCtx): { runId: string; chatId: string; messageId: string; at: number } {
  return { runId: ctx.runId, chatId: ctx.chatId, messageId: ctx.messageId, at: now(ctx) };
}

function titleOf(chunk: object): string | undefined {
  if ('title' in chunk && typeof chunk.title === 'string') return chunk.title;
  return undefined;
}

function stringifyError(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return 'Unknown tool error';
  try {
    return JSON.stringify(value);
  } catch {
    return 'Unknown tool error';
  }
}

export function mapFeedChunk(chunk: TextStreamPart<ToolSet>, ctx: FeedMapCtx): FeedDraft[] {
  const scope = base(ctx);
  switch (chunk.type) {
    case 'text-start':
      return [{ name: 'text-open', payload: { ...scope, sliceId: chunk.id } }];

    case 'text-delta':
      return [{ name: 'text-delta', payload: { ...scope, sliceId: chunk.id, delta: chunk.text } }];

    case 'text-end':
      return [{ name: 'text-close', payload: { ...scope, sliceId: chunk.id } }];

    case 'reasoning-start':
      return [{ name: 'think-open', payload: { ...scope, sliceId: chunk.id } }];

    case 'reasoning-delta':
      return [{ name: 'think-delta', payload: { ...scope, sliceId: chunk.id, delta: chunk.text } }];

    case 'reasoning-end':
      return [{ name: 'think-close', payload: { ...scope, sliceId: chunk.id } }];

    case 'tool-input-start': {
      const title = titleOf(chunk);
      return [
        {
          name: 'work-queued',
          payload: {
            ...scope,
            sliceId: chunk.id,
            callId: chunk.id,
            implement: chunk.toolName,
            ...(title !== undefined ? { title } : {}),
          },
        },
      ];
    }

    case 'tool-call': {
      const title = titleOf(chunk);
      return [
        {
          name: 'work-active',
          payload: {
            ...scope,
            sliceId: chunk.toolCallId,
            callId: chunk.toolCallId,
            implement: chunk.toolName,
            input: chunk.input,
            ...(title !== undefined ? { title } : {}),
          },
        },
      ];
    }

    case 'tool-result':
      return [
        {
          name: 'work-ok',
          payload: {
            ...scope,
            sliceId: chunk.toolCallId,
            callId: chunk.toolCallId,
            implement: chunk.toolName,
            input: chunk.input,
            output: chunk.output,
          },
        },
      ];

    case 'tool-error':
      return [
        {
          name: 'work-bad',
          payload: {
            ...scope,
            sliceId: chunk.toolCallId,
            callId: chunk.toolCallId,
            implement: chunk.toolName,
            input: chunk.input,
            errorText: stringifyError(chunk.error),
          },
        },
      ];

    case 'tool-output-denied': {
      const callId =
        'toolCallId' in chunk && typeof chunk.toolCallId === 'string'
          ? chunk.toolCallId
          : 'unknown';
      const implement =
        'toolName' in chunk && typeof chunk.toolName === 'string' ? chunk.toolName : 'unknown';
      return [
        {
          name: 'work-bad',
          payload: {
            ...scope,
            sliceId: callId,
            callId,
            implement,
            input: null,
            errorText: 'denied',
          },
        },
      ];
    }

    case 'source': {
      const record = chunk as unknown as Record<string, unknown>;
      const sliceId =
        typeof record.id === 'string'
          ? record.id
          : typeof record.sourceId === 'string'
            ? record.sourceId
            : `${scope.messageId}:src`;
      if (record.sourceType === 'url' && typeof record.url === 'string') {
        return [
          {
            name: 'asset',
            payload: {
              ...scope,
              sliceId,
              kind: 'link',
              url: record.url,
              ...(typeof record.title === 'string' ? { title: record.title } : {}),
            },
          },
        ];
      }
      return [
        {
          name: 'asset',
          payload: {
            ...scope,
            sliceId,
            kind: 'doc',
            ...(typeof record.title === 'string' ? { title: record.title } : {}),
            ...(typeof record.mediaType === 'string' ? { mediaType: record.mediaType } : {}),
            ...(typeof record.filename === 'string' ? { filename: record.filename } : {}),
          },
        },
      ];
    }

    case 'file':
    case 'reasoning-file': {
      const file = chunk.file as { base64?: unknown; mediaType?: unknown; url?: unknown };
      const mediaType = typeof file.mediaType === 'string' ? file.mediaType : undefined;
      const url =
        typeof file.base64 === 'string' && mediaType !== undefined
          ? `data:${mediaType};base64,${file.base64}`
          : typeof file.url === 'string'
            ? file.url
            : undefined;
      return [
        {
          name: 'asset',
          payload: {
            ...scope,
            sliceId: `${scope.messageId}:blob`,
            kind: 'blob',
            ...(url !== undefined ? { url } : {}),
            ...(mediaType !== undefined ? { mediaType } : {}),
          },
        },
      ];
    }

    case 'start-step':
      return [{ name: 'stage-open', payload: { ...scope, stage: ctx.stage } }];

    case 'error': {
      const mapped = mapAiError(chunk.error, { chatId: ctx.chatId });
      return [
        {
          name: 'oops',
          payload: {
            ...scope,
            code: mapped.code,
            message: mapped.message,
          },
        },
      ];
    }

    default:
      return [];
  }
}
