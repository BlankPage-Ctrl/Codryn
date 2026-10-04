import { parsePartialJson, type TextStreamPart, type ToolSet } from 'ai';
import type { NewMessagePartRow } from '../types/message.js';
import type { ToolPersistPolicy } from '../types/streaming-persister.js';

export const BUFFER_BATCH_SIZE = 10;

const MIN_BUFFER_BATCH_SIZE = 5;
const MAX_BUFFER_BATCH_SIZE = 15;

export function sanitizeBatchSize(value: number): number {
  if (!Number.isFinite(value)) return BUFFER_BATCH_SIZE;
  return Math.min(MAX_BUFFER_BATCH_SIZE, Math.max(MIN_BUFFER_BATCH_SIZE, Math.round(value)));
}

function stringifyMetadata(metadata: unknown): string | null {
  if (metadata == null) return null;
  try {
    return JSON.stringify(metadata);
  } catch {
    return null;
  }
}

export interface ToolInputBuffer {
  raw: string;
}

export function getChunkKey(chunk: TextStreamPart<ToolSet>): string | null {
  switch (chunk.type) {
    case 'text-start':
    case 'text-delta':
    case 'text-end':
    case 'reasoning-start':
    case 'reasoning-delta':
    case 'reasoning-end':
    case 'tool-input-start':
    case 'tool-input-delta':
    case 'tool-input-end':
      return chunk.id;

    case 'tool-call':
    case 'tool-result':
    case 'tool-error':
      return chunk.toolCallId;

    case 'source':
      return chunk.id;

    case 'file':
    case 'reasoning-file':
      return null;

    default:
      return null;
  }
}

export function createsPart(chunk: TextStreamPart<ToolSet>): boolean {
  switch (chunk.type) {
    case 'text-start':
    case 'reasoning-start':
    case 'tool-input-start':
    case 'tool-call':
    case 'tool-result':
    case 'tool-error':
    case 'source':
    case 'file':
    case 'reasoning-file':
    case 'start-step':
    case 'custom':
      return true;

    default:
      return false;
  }
}

export function getChunkToolName(chunk: TextStreamPart<ToolSet>): string | null {
  switch (chunk.type) {
    case 'tool-input-start':
    case 'tool-call':
    case 'tool-result':
    case 'tool-error':
      return chunk.toolName;

    default:
      return null;
  }
}

export function toolNameFromPartType(type: string): string | null {
  if (type.startsWith('tool-')) return type.slice('tool-'.length);
  return null;
}

export function shouldFlushImmediately(
  chunk: TextStreamPart<ToolSet>,
  toolPolicy?: ToolPersistPolicy,
): boolean {
  switch (chunk.type) {
    case 'tool-call':
    case 'tool-result':
    case 'tool-error':
      return true;

    case 'tool-input-start':
    case 'tool-input-delta':
      return toolPolicy === 'write-through';

    case 'source':
    case 'file':
    case 'reasoning-file':
    case 'start-step':
    case 'custom':
      return true;

    default:
      return false;
  }
}

export function createPartDraft(
  messageId: string,
  position: number,
  chunk: TextStreamPart<ToolSet>,
): NewMessagePartRow {
  const base = {
    id: crypto.randomUUID(),
    messageId,
    position,
    type: chunk.type,
  };

  switch (chunk.type) {
    case 'text-start':
      return {
        ...base,
        type: 'text',
        text: '',
        state: 'streaming',
        providerMetadataJson: stringifyMetadata(chunk.providerMetadata),
      };

    case 'reasoning-start':
      return {
        ...base,
        type: 'reasoning',
        text: '',
        state: 'streaming',
        providerMetadataJson: stringifyMetadata(chunk.providerMetadata),
      };

    case 'tool-input-start': {
      return {
        ...base,
        type: chunk.dynamic ? 'dynamic-tool' : `tool-${chunk.toolName}`,
        toolCallId: chunk.id,
        state: 'input-streaming',
        providerExecuted: chunk.providerExecuted ?? null,
        providerMetadataJson: stringifyMetadata(chunk.providerMetadata),
      };
    }

    case 'tool-call':
    case 'tool-result':
    case 'tool-error':
      return {
        ...base,
        type: chunk.dynamic ? 'dynamic-tool' : `tool-${chunk.toolName}`,
        toolCallId: chunk.toolCallId,
        state: 'input-streaming',
        inputJson: 'input' in chunk ? stringifyMetadata(chunk.input) : null,
        providerExecuted: chunk.providerExecuted ?? null,
        providerMetadataJson: stringifyMetadata(
          'providerMetadata' in chunk ? chunk.providerMetadata : undefined,
        ),
      };

    case 'source': {
      if (chunk.sourceType === 'url') {
        return {
          ...base,
          type: 'source-url',
          sourceId: chunk.id,
          url: chunk.url,
          title: chunk.title ?? null,
          providerMetadataJson: stringifyMetadata(chunk.providerMetadata),
        };
      }
      return {
        ...base,
        type: 'source-document',
        sourceId: chunk.id,
        title: chunk.title ?? null,
        mediaType: chunk.mediaType ?? null,
        filename: chunk.filename ?? null,
        providerMetadataJson: stringifyMetadata(chunk.providerMetadata),
      };
    }

    case 'file':
    case 'reasoning-file': {
      const mediaType = chunk.file.mediaType ?? null;
      const dataUrl = mediaType ? `data:${mediaType};base64,${chunk.file.base64}` : null;
      return {
        ...base,
        type: chunk.type,
        mediaType,
        url: dataUrl,
        providerMetadataJson: stringifyMetadata(chunk.providerMetadata),
      };
    }

    case 'start-step':
      return { ...base, type: 'step-start' };

    case 'custom':
      return {
        ...base,
        type: 'custom',
        dataJson: null,
        providerMetadataJson: stringifyMetadata(chunk.providerMetadata),
      };

    default:
      return base;
  }
}

export async function applyChunkToDraft(
  row: NewMessagePartRow,
  chunk: TextStreamPart<ToolSet>,
  inputBuffer?: ToolInputBuffer,
): Promise<void> {
  switch (chunk.type) {
    case 'text-delta':
      row.text = (row.text ?? '') + chunk.text;
      break;

    case 'text-end':
      row.state = 'done';
      if (chunk.providerMetadata) {
        row.providerMetadataJson = stringifyMetadata(chunk.providerMetadata);
      }
      break;

    case 'reasoning-delta':
      row.text = (row.text ?? '') + chunk.text;
      break;

    case 'reasoning-end':
      row.state = 'done';
      if (chunk.providerMetadata) {
        row.providerMetadataJson = stringifyMetadata(chunk.providerMetadata);
      }
      break;

    case 'tool-input-delta': {
      if (!inputBuffer) break;
      inputBuffer.raw += chunk.delta;
      const parsed = await parsePartialJson(inputBuffer.raw);
      if (parsed.state === 'successful-parse' || parsed.state === 'repaired-parse') {
        row.inputJson = JSON.stringify(parsed.value);
      }
      break;
    }

    case 'tool-call':
      row.inputJson = stringifyMetadata(chunk.input);
      row.state = 'input-available';
      if (chunk.providerMetadata) {
        row.providerMetadataJson = stringifyMetadata(chunk.providerMetadata);
      }
      break;

    case 'tool-result':
      row.outputJson = stringifyMetadata(chunk.output);
      row.state = 'output-available';
      row.providerExecuted = chunk.providerExecuted ?? row.providerExecuted;
      if (chunk.providerMetadata) {
        row.providerMetadataJson = stringifyMetadata(chunk.providerMetadata);
      }
      break;

    case 'tool-error': {
      // The error chunk carries the model input, but the SDK may send it as
      // undefined (provider-executed tools, unmatched tool results). Persist
      // it when present so failed calls stay evaluable via input_json.
      // Never clobber an existing value with null.
      if (chunk.input != null) {
        const encoded = stringifyMetadata(chunk.input);
        if (encoded != null) {
          row.inputJson = encoded;
        }
      }
      row.errorText =
        typeof chunk.error === 'string'
          ? chunk.error
          : chunk.error == null
            ? 'Unknown tool error'
            : JSON.stringify(chunk.error);
      row.state = 'output-error';
      row.providerExecuted = chunk.providerExecuted ?? row.providerExecuted;
      if (chunk.providerMetadata) {
        row.providerMetadataJson = stringifyMetadata(chunk.providerMetadata);
      }
      break;
    }

    default:
      break;
  }
}
