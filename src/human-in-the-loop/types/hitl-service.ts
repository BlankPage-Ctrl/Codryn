import type { HitlRequest, HitlRequestInput, HitlResponse } from './common.js';

export interface IHitlService {
  request(input: HitlRequestInput): Promise<HitlRequest>;
  requestAndWait(input: HitlRequestInput): Promise<HitlRequest>;
  submitResponse(id: string, response: HitlResponse): Promise<HitlRequest>;
  cancel(id: string): Promise<void>;

  getById(id: string): Promise<HitlRequest | null>;
  listPending(): Promise<HitlRequest[]>;
  readonly events: {
    on<K extends keyof import('./events.js').HitlEventMap>(
      name: K,
      handler: import('./events.js').HitlEventHandler<K>,
    ): void;
    off<K extends keyof import('./events.js').HitlEventMap>(
      name: K,
      handler: import('./events.js').HitlEventHandler<K>,
    ): void;
  };
}
