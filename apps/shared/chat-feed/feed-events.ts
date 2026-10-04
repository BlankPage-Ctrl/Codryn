export interface FeedRunOpen {
  runId: string;
  chatId: string;
  assistantMessageId: string;
  at: number;
}

export type FeedRunCloseStatus = 'done' | 'failed' | 'cancelled';

export interface FeedRunClose {
  runId: string;
  chatId: string;
  assistantMessageId: string;
  status: FeedRunCloseStatus;
  at: number;
  code?: string;
  message?: string;
}

export interface FeedTextOpen {
  runId: string;
  chatId: string;
  messageId: string;
  sliceId: string;
  at: number;
}

export interface FeedTextDelta extends FeedTextOpen {
  delta: string;
}

export type FeedTextClose = FeedTextOpen;

export interface FeedThinkOpen {
  runId: string;
  chatId: string;
  messageId: string;
  sliceId: string;
  at: number;
}

export interface FeedThinkDelta extends FeedThinkOpen {
  delta: string;
}

export type FeedThinkClose = FeedThinkOpen;

export interface FeedWorkQueued {
  runId: string;
  chatId: string;
  messageId: string;
  sliceId: string;
  callId: string;
  implement: string;
  at: number;
  title?: string;
}

export interface FeedWorkActive extends FeedWorkQueued {
  input: unknown;
}

export interface FeedWorkOk extends FeedWorkQueued {
  input: unknown;
  output: unknown;
}

export interface FeedWorkBad extends FeedWorkQueued {
  input: unknown;
  errorText: string;
}

export interface FeedStageOpen {
  runId: string;
  chatId: string;
  messageId: string;
  stage: number;
  at: number;
}

export interface FeedStageClose extends FeedStageOpen {
  landed: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type FeedAssetKind = 'link' | 'doc' | 'blob';

export interface FeedAsset {
  runId: string;
  chatId: string;
  messageId: string;
  sliceId: string;
  kind: FeedAssetKind;
  at: number;
  url?: string;
  title?: string;
  mediaType?: string;
  filename?: string;
}

export interface FeedNotice {
  runId: string;
  chatId: string;
  messageId: string;
  sliceId: string;
  callId: string;
  implement: string;
  body: unknown;
  at: number;
}

export interface FeedOops {
  runId: string;
  chatId: string;
  messageId: string;
  code: string;
  message: string;
  at: number;
  details?: unknown;
}

export interface ChatFeedEventMap {
  'run-open': FeedRunOpen;
  'run-close': FeedRunClose;
  'text-open': FeedTextOpen;
  'text-delta': FeedTextDelta;
  'text-close': FeedTextClose;
  'think-open': FeedThinkOpen;
  'think-delta': FeedThinkDelta;
  'think-close': FeedThinkClose;
  'work-queued': FeedWorkQueued;
  'work-active': FeedWorkActive;
  'work-ok': FeedWorkOk;
  'work-bad': FeedWorkBad;
  'stage-open': FeedStageOpen;
  'stage-close': FeedStageClose;
  asset: FeedAsset;
  notice: FeedNotice;
  oops: FeedOops;
}

export type ChatFeedEventName = keyof ChatFeedEventMap;

export const CHAT_FEED_NAMES: ChatFeedEventName[] = [
  'run-open',
  'run-close',
  'text-open',
  'text-delta',
  'text-close',
  'think-open',
  'think-delta',
  'think-close',
  'work-queued',
  'work-active',
  'work-ok',
  'work-bad',
  'stage-open',
  'stage-close',
  'asset',
  'notice',
  'oops',
];

export type ChatFeedEventHandler<K extends ChatFeedEventName> = (
  payload: ChatFeedEventMap[K],
) => void;

export interface IChatFeedBus {
  on<K extends ChatFeedEventName>(name: K, handler: ChatFeedEventHandler<K>): void;
  off<K extends ChatFeedEventName>(name: K, handler: ChatFeedEventHandler<K>): void;
  emit<K extends ChatFeedEventName>(name: K, payload: ChatFeedEventMap[K]): void;
}

export type FeedWireEvent = {
  [K in ChatFeedEventName]: { type: K; seq?: number } & ChatFeedEventMap[K];
}[ChatFeedEventName];

export type FeedHistoryEvent = {
  [K in ChatFeedEventName]: Omit<Extract<FeedWireEvent, { type: K }>, 'runId' | 'seq'> & {
    runId?: string;
    role: string;
  };
}[ChatFeedEventName];
