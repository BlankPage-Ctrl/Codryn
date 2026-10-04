// Domain types, Zod schemas, and response factories
export type {
  HITLStatus,
  HITLMetadata,
  HitlRequest,
  HitlRequestInput,
  HitlResponse,
  HitlPayload,
  ApprovalRequest,
  AskRequest,
  ChoiceRequest,
} from './types/common.js';
export {
  HITLStatusSchema,
  HITLMetadataSchema,
  HitlRequestInputSchema,
  DEFAULT_TIMEOUT_MS,
  isApprovalRequest,
  isAskRequest,
  isChoiceRequest,
} from './types/common.js';

export {
  ApprovalOutcomeSchema,
  ApprovalPayloadSchema,
  ApprovalResponseSchema,
  type ApprovalOutcome,
  type ApprovalPayload,
  type ApprovalResponse,
} from './types/approval.js';

export {
  AskPayloadSchema,
  AskResponseShape,
  AskStepSchema,
  makeAskResponseSchema,
  type AskPayload,
  type AskResponse,
  type AskStep,
  type AskResponseConstraints,
} from './types/ask.js';

export {
  ChoiceModeSchema,
  ChoiceOptionSchema,
  ChoicePayloadSchema,
  ChoiceResponseShape,
  makeChoiceResponseSchema,
  type ChoiceMode,
  type ChoiceOption,
  type ChoicePayload,
  type ChoiceResponse,
  type ChoiceResponseContext,
} from './types/choice.js';

export type { HitlEventMap, HitlEventName, HitlEventHandler } from './types/events.js';
export type { IColdHitlStorage } from './types/cold-hitl-storage.js';
export type { IHitlRepository } from './types/hitl-repository.js';
export type { IHitlService } from './types/hitl-service.js';

// Drizzle schema + drizzle-zod mirrors
export {
  hitlRequests,
  type HitlRequestRow,
  type NewHitlRequestRow,
  type HitlRequestPatchRow,
} from './schemas/index.js';
export {
  hitlRequestInsertSchema,
  hitlRequestSelectSchema,
  hitlRequestUpdateSchema,
} from './schemas/zod/index.js';

// Storage / repository / service
export { ColdHitlStorage } from './storages/cold/index.js';
export { HitlRepository } from './repository/index.js';
export { HitlEventBus } from './services/event-bus.js';
export { HitlService } from './services/index.js';

// Errors
export {
  ValidationError,
  HitlRequestNotFoundError,
  ConflictError,
  InvariantError,
  PermissionError,
  TimeoutError,
  CancelledError,
  StorageWriteError,
  StorageReadError,
  HitlDomainError,
} from './errors/index.js';
