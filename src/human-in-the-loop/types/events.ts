import type { HitlRequest, HitlResponse } from './common.js';

export interface HitlEventMap {
  request: HitlRequest;
  resolved: { request: HitlRequest; response: HitlResponse };
  expired: HitlRequest;
  cancelled: HitlRequest;
}

export type HitlEventName = keyof HitlEventMap;

export type HitlEventHandler<K extends HitlEventName> = (payload: HitlEventMap[K]) => void;
