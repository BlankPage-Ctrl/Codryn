import {
  DEFAULT_TIMEOUT_MS,
  HitlRequestInputSchema,
  type HitlRequest,
  type HitlRequestInput,
  type HitlResponse,
  isApprovalRequest,
} from '../types/common.js';
import type { IHitlService } from '../types/hitl-service.js';
import type { IHitlRepository } from '../types/hitl-repository.js';
import { ApprovalResponseSchema } from '../types/approval.js';
import { makeAskResponseSchema } from '../types/ask.js';
import { makeChoiceResponseSchema } from '../types/choice.js';
import type { HitlEventBus } from './event-bus.js';
import { HitlEventBus as EventBus } from './event-bus.js';
import { ZodError } from 'zod';
import {
  ValidationError,
  HitlRequestNotFoundError,
  ConflictError,
  TimeoutError,
  CancelledError,
} from '../errors/index.js';

interface PendingEntry {
  resolve: (request: HitlRequest) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | null;
}

export class HitlService implements IHitlService {
  private readonly bus: HitlEventBus;
  private readonly pending = new Map<string, PendingEntry>();

  constructor(
    private readonly repo: IHitlRepository,
    bus?: HitlEventBus,
  ) {
    this.bus = bus ?? new EventBus();
  }

  get events(): HitlEventBus {
    return this.bus;
  }

  async request(input: HitlRequestInput): Promise<HitlRequest> {
    const parsed = HitlRequestInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid HITL request: ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join(', ')}`,
        { issues: parsed.error.issues },
      );
    }

    const data = parsed.data;
    const now = new Date();
    const timeoutMs = data.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const request = {
      id: crypto.randomUUID(),
      type: data.type,
      title: data.title,
      description: data.description ?? null,
      correlationId: data.correlationId ?? null,
      workspaceId: data.workspaceId ?? null,
      chatId: data.chatId,
      executionId: data.executionId ?? null,
      metadata: data.metadata,
      status: 'pending',
      response: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + timeoutMs),
      resolvedAt: null,
      payload: (data.payload ?? {}) as HitlRequest['payload'],
    } as HitlRequest;

    await this.repo.insert(request);

    const timer = setTimeout(() => {
      void this.handleTimeout(request.id, request.type);
    }, timeoutMs);

    this.pending.set(request.id, {
      resolve: () => {},
      reject: () => {},
      timer,
    });

    this.bus.emit('request', request);
    return request;
  }

  async requestAndWait(input: HitlRequestInput): Promise<HitlRequest> {
    const request = await this.request(input);
    return new Promise<HitlRequest>((resolve, reject) => {
      this.rebindPending(request.id, resolve, reject);
    });
  }

  async submitResponse(id: string, response: HitlResponse): Promise<HitlRequest> {
    const request = await this.repo.findById(id);
    if (!request) throw new HitlRequestNotFoundError(id);
    if (request.status !== 'pending') {
      throw new ConflictError(`HITL request ${id} is ${request.status}, cannot submit response`, {
        id,
        status: request.status,
      });
    }

    const validated = this.validateResponse(request, response);
    const now = new Date();

    const updated = await this.repo.update(id, {
      status: 'resolved',
      response: validated,
      resolvedAt: now,
      updatedAt: now,
    } as Partial<HitlRequest>);

    this.clearTimer(id);
    this.resolvePending(id, updated);
    this.bus.emit('resolved', { request: updated, response: validated });
    return updated;
  }

  async cancel(id: string): Promise<void> {
    const request = await this.repo.findById(id);
    if (!request) throw new HitlRequestNotFoundError(id);
    if (request.status !== 'pending') {
      throw new ConflictError(`HITL request ${id} is ${request.status}, cannot cancel`, {
        id,
        status: request.status,
      });
    }

    const now = new Date();
    const updated = await this.repo.update(id, {
      status: 'cancelled',
      updatedAt: now,
    } as Partial<HitlRequest>);

    this.clearTimer(id);
    this.rejectPending(id, new CancelledError(`HITL request ${id} cancelled`, { id }));
    this.bus.emit('cancelled', updated);
  }

  async getById(id: string): Promise<HitlRequest | null> {
    return this.repo.findById(id);
  }

  async listPending(): Promise<HitlRequest[]> {
    return this.repo.listByStatus('pending');
  }

  private validateResponse(request: HitlRequest, response: HitlResponse): HitlResponse {
    try {
      if (isApprovalRequest(request)) {
        const value = ApprovalResponseSchema.parse(response);
        if (
          request.payload.requireReasonOnReject &&
          value.outcome === 'rejected' &&
          !value.reason
        ) {
          throw new ValidationError('reason is required when rejecting this approval', {
            id: request.id,
          });
        }
        return value;
      }
      if (request.type === 'ask') {
        const p = request.payload;
        return makeAskResponseSchema({
          minLength: p.minLength,
          maxLength: p.maxLength,
          validationRegex: p.validationRegex,
        }).parse(response) as HitlResponse;
      }
      const p = request.payload;
      return makeChoiceResponseSchema({
        mode: p.mode,
        optionIds: p.options.map((o) => o.id),
        minSelect: p.minSelect,
        maxSelect: p.maxSelect,
        allowOther: p.allowOther,
      }).parse(response) as HitlResponse;
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      if (err instanceof ZodError) {
        throw new ValidationError(
          `Invalid HITL response: ${err.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join(', ')}`,
          { issues: err.issues, id: request.id, type: request.type },
        );
      }
      throw err;
    }
  }

  private async handleTimeout(id: string, type: HitlRequest['type']): Promise<void> {
    // A storage failure here must reach the waiter via rejectPending, without
    // this catch the fire-and-forget timer would produce an unhandled rejection
    // and the waiter would hang forever.
    try {
      await this.expireRequest(id, type);
    } catch (err) {
      this.rejectPending(id, err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async expireRequest(id: string, type: HitlRequest['type']): Promise<void> {
    const request = await this.repo.findById(id);
    if (!request || request.status !== 'pending') return;

    const now = new Date();

    if (type === 'approval') {
      const response: HitlResponse = { outcome: 'rejected' };
      const updated = await this.repo.update(id, {
        status: 'resolved',
        response,
        resolvedAt: now,
        updatedAt: now,
      } as Partial<HitlRequest>);
      this.resolvePending(id, updated);
      this.bus.emit('resolved', { request: updated, response });
      return;
    }

    const updated = await this.repo.update(id, {
      status: 'expired',
      updatedAt: now,
    } as Partial<HitlRequest>);
    this.rejectPending(id, new TimeoutError(`HITL request ${id} expired`, { id, type }));
    this.bus.emit('expired', updated);
  }

  private rebindPending(
    id: string,
    resolve: (request: HitlRequest) => void,
    reject: (error: Error) => void,
  ): void {
    const entry = this.pending.get(id);
    if (!entry) {
      this.pending.set(id, { resolve, reject, timer: null });
      return;
    }
    entry.resolve = resolve;
    entry.reject = reject;
  }

  private resolvePending(id: string, request: HitlRequest): void {
    const entry = this.pending.get(id);
    if (entry) {
      entry.resolve(request);
      this.pending.delete(id);
    }
  }

  private rejectPending(id: string, error: Error): void {
    const entry = this.pending.get(id);
    if (entry) {
      entry.reject(error);
      this.pending.delete(id);
    }
  }

  private clearTimer(id: string): void {
    const entry = this.pending.get(id);
    if (entry?.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
  }
}
