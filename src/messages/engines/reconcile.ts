import type { NewMessagePartRow } from '../types/message.js';

export function indexRichByCallId(
  rows: Array<Pick<NewMessagePartRow, 'toolCallId' | 'dataJson'>>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    if (
      typeof row.toolCallId === 'string' &&
      typeof row.dataJson === 'string' &&
      !out.has(row.toolCallId)
    ) {
      out.set(row.toolCallId, row.dataJson);
    }
  }
  return out;
}

function isToolType(type: string): boolean {
  return type === 'dynamic-tool' || type.startsWith('tool-');
}

export function sanitizeFinalPart(
  part: NewMessagePartRow,
  richByCallId: Map<string, string>,
): NewMessagePartRow {
  switch (part.type) {
    case 'text':
    case 'reasoning':
      return {
        ...part,
        toolCallId: null,
        inputJson: null,
        outputJson: null,
        errorText: null,
        providerExecuted: null,
        sourceId: null,
        url: null,
        title: null,
        mediaType: null,
        filename: null,
        dataJson: null,
      };

    case 'step-start':
      return {
        ...part,
        text: null,
        toolCallId: null,
        inputJson: null,
        outputJson: null,
        errorText: null,
        providerExecuted: null,
        sourceId: null,
        url: null,
        title: null,
        mediaType: null,
        filename: null,
        dataJson: null,
      };

    case 'source-url':
      return {
        ...part,
        text: null,
        toolCallId: null,
        inputJson: null,
        outputJson: null,
        errorText: null,
        providerExecuted: null,
        mediaType: null,
        filename: null,
        dataJson: null,
      };

    case 'source-document':
      return {
        ...part,
        text: null,
        toolCallId: null,
        inputJson: null,
        outputJson: null,
        errorText: null,
        providerExecuted: null,
        url: null,
        dataJson: null,
      };

    case 'file':
    case 'reasoning-file':
      return {
        ...part,
        text: null,
        toolCallId: null,
        inputJson: null,
        outputJson: null,
        errorText: null,
        providerExecuted: null,
        sourceId: null,
        title: null,
        dataJson: null,
      };

    case 'custom':
      return {
        ...part,
        text: null,
        toolCallId: null,
        inputJson: null,
        outputJson: null,
        errorText: null,
        providerExecuted: null,
        sourceId: null,
        url: null,
        title: null,
        mediaType: null,
        filename: null,
      };

    default: {
      if (isToolType(part.type)) {
        const rescued =
          part.dataJson ??
          (typeof part.toolCallId === 'string' ? richByCallId.get(part.toolCallId) : undefined);
        return {
          ...part,
          text: null,
          sourceId: null,
          url: null,
          title: null,
          mediaType: null,
          filename: null,
          dataJson: rescued ?? null,
        };
      }
      if (part.type.startsWith('data-')) {
        return {
          ...part,
          text: null,
          toolCallId: null,
          inputJson: null,
          outputJson: null,
          errorText: null,
          providerExecuted: null,
          sourceId: null,
          url: null,
          title: null,
          mediaType: null,
          filename: null,
        };
      }
      return part;
    }
  }
}
