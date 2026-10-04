import { z } from 'zod';
import { ApprovalPayloadSchema, type ApprovalPayload, type ApprovalResponse } from './approval.js';
import { AskPayloadSchema, type AskPayload, type AskResponse } from './ask.js';
import { ChoicePayloadSchema, type ChoicePayload, type ChoiceResponse } from './choice.js';

export const HITLStatusSchema = z.enum(['pending', 'resolved', 'expired', 'cancelled']);
export type HITLStatus = z.infer<typeof HITLStatusSchema>;

export const HITLMetadataSchema = z.record(
  z.string().trim().min(1).max(120),
  z.union([z.string(), z.number(), z.boolean()]),
);
export type HITLMetadata = z.infer<typeof HITLMetadataSchema>;

export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export const HitlBaseInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5_000).optional(),
  correlationId: z.string().trim().min(1).max(120).optional(),
  workspaceId: z.string().trim().min(1).max(120).optional(),
  chatId: z.string().trim().min(1).max(120),
  executionId: z.string().trim().min(1).max(120).optional(),
  metadata: HITLMetadataSchema.optional().default({}),
  timeoutMs: z.number().int().positive().max(3_600_000).optional(),
});
export type HitlBaseInput = z.infer<typeof HitlBaseInputSchema>;

const approvalInputSchema = HitlBaseInputSchema.extend({
  type: z.literal('approval'),
  payload: ApprovalPayloadSchema.optional(),
}).strict();

const askInputSchema = HitlBaseInputSchema.extend({
  type: z.literal('ask'),
  payload: AskPayloadSchema.optional(),
}).strict();

const choiceInputSchema = HitlBaseInputSchema.extend({
  type: z.literal('choice'),
  payload: ChoicePayloadSchema,
}).strict();

export const HitlRequestInputSchema = z.discriminatedUnion('type', [
  approvalInputSchema,
  askInputSchema,
  choiceInputSchema,
]);
export type HitlRequestInput = z.input<typeof HitlRequestInputSchema>;

export type HitlPayload = ApprovalPayload | AskPayload | ChoicePayload;
export type HitlResponse = ApprovalResponse | AskResponse | ChoiceResponse;

interface HitlRequestBase {
  id: string;
  title: string;
  description: string | null;
  correlationId: string | null;
  workspaceId: string | null;
  chatId: string;
  executionId: string | null;
  metadata: HITLMetadata;
  status: HITLStatus;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  resolvedAt: Date | null;
}

export type ApprovalRequest = HitlRequestBase & {
  type: 'approval';
  payload: ApprovalPayload;
  response: ApprovalResponse | null;
};

export type AskRequest = HitlRequestBase & {
  type: 'ask';
  payload: AskPayload;
  response: AskResponse | null;
};

export type ChoiceRequest = HitlRequestBase & {
  type: 'choice';
  payload: ChoicePayload;
  response: ChoiceResponse | null;
};

export type HitlRequest = ApprovalRequest | AskRequest | ChoiceRequest;

export function isApprovalRequest(r: HitlRequest): r is ApprovalRequest {
  return r.type === 'approval';
}
export function isAskRequest(r: HitlRequest): r is AskRequest {
  return r.type === 'ask';
}
export function isChoiceRequest(r: HitlRequest): r is ChoiceRequest {
  return r.type === 'choice';
}
