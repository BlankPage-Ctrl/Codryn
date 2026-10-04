import type { createUIMessageStreamResponse, UIMessage, UIMessageStreamOptions } from 'ai';

type UIMessageStreamResponseInit = Omit<
  Parameters<typeof createUIMessageStreamResponse>[0],
  'stream'
>;

export type UIStreamResponseOptions = UIMessageStreamResponseInit &
  UIMessageStreamOptions<UIMessage>;

export type RawDataEmit = (part: { type: string; id: string; data: unknown }) => void;
