import type { UIMessage } from 'ai';
import type {
  MessageEntity,
  MessageWithParts,
  MessagePartRow,
  NewMessagePartRow,
} from '../types/message.js';

function extractPartDbFields(
  messageId: string,
  position: number,
  part: UIMessage['parts'][number],
): NewMessagePartRow {
  const base = {
    id: crypto.randomUUID(),
    messageId,
    position,
    type: part.type,
  };

  switch (part.type) {
    case 'text': {
      const p = part as { text: string; state?: string; isSystem?: boolean };
      return {
        ...base,
        text: p.text,
        state: p.state ?? null,
        isSystem: p.isSystem,
      };
    }

    case 'reasoning': {
      const p = part;
      return {
        ...base,
        text: p.text,
        state: p.state ?? null,
        providerMetadataJson: p.providerMetadata ? JSON.stringify(p.providerMetadata) : null,
      };
    }

    case 'source-url': {
      const p = part;
      return {
        ...base,
        sourceId: p.sourceId,
        url: p.url,
        title: p.title ?? null,
        providerMetadataJson: p.providerMetadata ? JSON.stringify(p.providerMetadata) : null,
      };
    }

    case 'source-document': {
      const p = part;
      return {
        ...base,
        sourceId: p.sourceId,
        mediaType: p.mediaType,
        title: p.title,
        filename: p.filename ?? null,
        providerMetadataJson: p.providerMetadata ? JSON.stringify(p.providerMetadata) : null,
      };
    }

    case 'file': {
      const p = part;
      return {
        ...base,
        mediaType: p.mediaType,
        url: p.url,
        filename: p.filename ?? null,
      };
    }

    case 'step-start':
      return base;

    case 'dynamic-tool': {
      const p = part;
      return {
        ...base,
        type: p.type,
        toolCallId: p.toolCallId,
        state: p.state ?? null,
        inputJson: p.input != null ? JSON.stringify(p.input) : null,
        outputJson: p.output != null ? JSON.stringify(p.output) : null,
        errorText: p.errorText ?? null,
        providerExecuted: p.providerExecuted ?? null,
        providerMetadataJson: p.callProviderMetadata
          ? JSON.stringify(p.callProviderMetadata)
          : null,
      };
    }

    default: {
      const raw = part as Record<string, unknown>;
      const t = raw.type as string;

      if (t.startsWith('tool-')) {
        return {
          ...base,
          type: t,
          toolCallId: typeof raw.toolCallId === 'string' ? raw.toolCallId : null,
          state: typeof raw.state === 'string' ? raw.state : null,
          inputJson: raw.input != null ? JSON.stringify(raw.input) : null,
          outputJson: raw.output != null ? JSON.stringify(raw.output) : null,
          errorText: typeof raw.errorText === 'string' ? raw.errorText : null,
          providerExecuted: typeof raw.providerExecuted === 'boolean' ? raw.providerExecuted : null,
          providerMetadataJson:
            raw.callProviderMetadata != null
              ? JSON.stringify(raw.callProviderMetadata)
              : raw.providerMetadata != null
                ? JSON.stringify(raw.providerMetadata)
                : null,
        };
      }

      return {
        ...base,
        type: t,
        dataJson: raw.data != null ? JSON.stringify(raw.data) : null,
        id: typeof raw.id === 'string' ? raw.id : undefined,
      };
    }
  }
}

function extractPartUiFields(part: MessagePartRow): UIMessage['parts'][number] {
  const { type } = part;

  switch (type) {
    case 'text':
      return {
        type: 'text',
        text: part.text ?? '',
        ...(part.state ? { state: part.state as 'streaming' | 'done' } : {}),
        ...(part.isSystem ? { isSystem: true } : {}),
      };

    case 'reasoning':
      return {
        type: 'reasoning',
        text: part.text ?? '',
        ...(part.state ? { state: part.state as 'streaming' | 'done' } : {}),
        ...(part.providerMetadataJson
          ? {
              /* eslint-disable @typescript-eslint/no-explicit-any */
              providerMetadata: safeJsonParse(part.providerMetadataJson) as Record<string, any>,
              /* eslint-enable @typescript-eslint/no-explicit-any */
            }
          : {}),
      };

    case 'source-url':
      return {
        type: 'source-url',
        sourceId: part.sourceId ?? '',
        url: part.url ?? '',
        ...(part.title != null ? { title: part.title } : {}),
        ...(part.providerMetadataJson
          ? {
              /* eslint-disable @typescript-eslint/no-explicit-any */
              providerMetadata: safeJsonParse(part.providerMetadataJson) as Record<string, any>,
              /* eslint-enable @typescript-eslint/no-explicit-any */
            }
          : {}),
      };

    case 'source-document':
      return {
        type: 'source-document',
        sourceId: part.sourceId ?? '',
        mediaType: part.mediaType ?? '',
        title: part.title ?? '',
        ...(part.filename != null ? { filename: part.filename } : {}),
        ...(part.providerMetadataJson
          ? {
              /* eslint-disable @typescript-eslint/no-explicit-any */
              providerMetadata: safeJsonParse(part.providerMetadataJson) as Record<string, any>,
              /* eslint-enable @typescript-eslint/no-explicit-any */
            }
          : {}),
      };

    case 'file':
      return {
        type: 'file',
        mediaType: part.mediaType ?? '',
        url: part.url ?? '',
        ...(part.filename != null ? { filename: part.filename } : {}),
      };

    case 'step-start':
      return { type: 'step-start' };

    default: {
      if (type.startsWith('tool-')) {
        return {
          type: type as `tool-${string}`,
          toolCallId: part.toolCallId ?? '',
          state: part.state ?? 'output-available',
          ...(part.inputJson != null ? { input: safeJsonParse(part.inputJson) } : {}),
          ...(part.outputJson != null ? { output: safeJsonParse(part.outputJson) } : {}),
          ...(part.errorText != null ? { errorText: part.errorText } : {}),
          ...(part.providerExecuted != null ? { providerExecuted: part.providerExecuted } : {}),
          ...(part.providerMetadataJson
            ? { providerMetadata: safeJsonParse(part.providerMetadataJson) }
            : {}),
        } as UIMessage['parts'][number];
      }

      return { type: 'text', text: part.text ?? '' };
    }
  }
}

export class UIMessageMapper {
  static toEntities(msgs: UIMessage[], chatId: string): MessageEntity[] {
    return msgs.map((msg, msgIndex) => ({
      id: msg.id,
      chatId,
      role: msg.role,
      position: msgIndex,
      metadataJson: msg.metadata != null ? JSON.stringify(msg.metadata) : null,
      createdAt: new Date().toISOString(),
      parts: msg.parts.map((part, partIndex) => extractPartDbFields(msg.id, partIndex, part)),
    }));
  }

  static toUIMessages(entities: MessageWithParts[]): UIMessage[] {
    return [...entities]
      .sort((a, b) => a.position - b.position)
      .map((msgEntity) => {
        const parts = (msgEntity.parts ?? [])
          .slice()
          .sort((a, b) => a.position - b.position)
          .map(extractPartUiFields);

        const uiMsg: UIMessage = {
          id: msgEntity.id,
          role: msgEntity.role as UIMessage['role'],
          parts,
        };

        if (msgEntity.metadataJson) {
          uiMsg.metadata = safeJsonParse(msgEntity.metadataJson);
        }

        return uiMsg;
      });
  }

  static partToEntity(
    messageId: string,
    position: number,
    part: UIMessage['parts'][number],
  ): NewMessagePartRow {
    return extractPartDbFields(messageId, position, part);
  }

  static entityToPart(part: MessagePartRow): UIMessage['parts'][number] {
    return extractPartUiFields(part);
  }
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
