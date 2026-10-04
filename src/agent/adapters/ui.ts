import {
  consumeStream,
  convertToModelMessages,
  createUIMessageStream,
  streamText,
  toUIMessageStream,
  createUIMessageStreamResponse,
} from 'ai';
import type { UIMessage } from 'ai';
import type { RawDataEmit, UIStreamResponseOptions } from '../types/index.js';
import { formatToolChunkError } from './chunk-error.js';

export { convertToModelMessages, consumeStream };

type DefaultStreamResult = ReturnType<typeof streamText>;

interface UiChunk {
  type: string;
  id: string;
  data: unknown;
}

export function toUIMessageStreamResponse(
  startAgent: (emit: RawDataEmit) => Promise<DefaultStreamResult> | DefaultStreamResult,
  options?: UIStreamResponseOptions,
): Response {
  const { status, statusText, headers, consumeSseStream, onEnd, onError, ...streamOptions } =
    options ?? {};
  const pending = new Map<string, UiChunk>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let writerRef: { write: (part: any) => void } | undefined;
  const emit: RawDataEmit = (part) => {
    pending.set(part.id, part);
    try {
      writerRef?.write(part);
    } catch {
      // Stream may already be closing; onEnd backfill covers persistence.
    }
  };

  const stream = createUIMessageStream<UIMessage>({
    ...(streamOptions.originalMessages != null
      ? { originalMessages: streamOptions.originalMessages as UIMessage[] }
      : {}),
    ...(streamOptions.generateMessageId != null
      ? { generateId: streamOptions.generateMessageId }
      : {}),
    execute: async ({ writer }) => {
      writerRef = writer as unknown as { write: (part: unknown) => void };
      const result = await startAgent(emit);
      if (!result?.stream) {
        throw new TypeError(
          'toUIMessageStreamResponse: result.stream is undefined — agent fallback likely returned a plain object without prototype getters (check withReasoningFallback)',
        );
      }
      writer.merge(
        toUIMessageStream({
          stream: result.stream,
          ...streamOptions,
          // Chunk-level errors (e.g. tool input validation failures) are
          // redacted to "An error occurred." by default; surface field-level
          // detail for validation errors so the model can fix its call.
          // Stream-level onError above is untouched.
          onError: formatToolChunkError,
        } as never) as never,
      );
    },
    onEnd: async (event) => {
      if (pending.size > 0) {
        const parts = (event.responseMessage.parts ?? []) as Array<
          Record<string, unknown> & { id?: unknown }
        >;
        const existingIds = new Set(parts.map((p) => p.id));
        for (const part of pending.values()) {
          if (!existingIds.has(part.id)) {
            parts.push({ ...part });
            existingIds.add(part.id);
          }
        }
        const idx = event.messages.findIndex((m) => m.id === event.responseMessage.id);
        if (idx >= 0) event.messages[idx] = event.responseMessage;
      }
      await onEnd?.(event as never);
    },
    ...(onError ? { onError } : {}),
  });

  return createUIMessageStreamResponse({
    stream: stream as never,
    status,
    statusText,
    headers,
    consumeSseStream: consumeSseStream ?? consumeStream,
  });
}
