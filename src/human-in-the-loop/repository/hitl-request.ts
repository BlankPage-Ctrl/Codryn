import type { HITLStatus, HitlRequest } from '../types/common.js';
import {
  ApprovalPayloadSchema,
  ApprovalResponseSchema,
  type ApprovalPayload,
  type ApprovalResponse,
} from '../types/approval.js';
import {
  AskPayloadSchema,
  AskResponseShape,
  type AskPayload,
  type AskResponse,
} from '../types/ask.js';
import {
  ChoicePayloadSchema,
  ChoiceResponseShape,
  type ChoicePayload,
  type ChoiceResponse,
} from '../types/choice.js';
import type { IColdHitlStorage } from '../types/cold-hitl-storage.js';
import type { IHitlRepository } from '../types/hitl-repository.js';
import { hitlRequestInsertSchema, hitlRequestSelectSchema } from '../schemas/zod/index.js';
import type { HitlRequestRow, HitlRequestPatchRow } from '../schemas/index.js';
import { ValidationError } from '../errors/validation.js';
import { HitlDomainError } from '../errors/base.js';

// error details here carry only identifiers (id / type) - never the raw
// JSON blobs, which may contain user-typed command text.

function causeOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseJsonField(field: string, json: string, context: Record<string, unknown>): unknown {
  try {
    return JSON.parse(json);
  } catch (err) {
    if (err instanceof HitlDomainError) throw err;
    throw new ValidationError(`Invalid stored ${field} JSON`, { ...context, cause: causeOf(err) });
  }
}

function parseRow(row: unknown, context: Record<string, unknown>): HitlRequestRow {
  try {
    return hitlRequestSelectSchema.parse(row);
  } catch (err) {
    if (err instanceof HitlDomainError) throw err;
    throw new ValidationError('Invalid HITL row from storage', { ...context, cause: causeOf(err) });
  }
}

function parsePayload(type: HitlRequestRow['type'], json: string, id: string) {
  const value = parseJsonField('payload', json, { id, type });
  try {
    // each schema's inferred output matches the corresponding payload type.
    if (type === 'approval') return ApprovalPayloadSchema.parse(value) as ApprovalPayload;
    if (type === 'ask') return AskPayloadSchema.parse(value) as AskPayload;
    return ChoicePayloadSchema.parse(value) as ChoicePayload;
  } catch (err) {
    if (err instanceof HitlDomainError) throw err;
    throw new ValidationError('Invalid stored payload', { id, type, cause: causeOf(err) });
  }
}

function parseResponse(type: HitlRequestRow['type'], json: string | null, id: string) {
  if (json === null) return null;
  const value = parseJsonField('response', json, { id, type });
  try {
    // Each schema's inferred output matches the corresponding response type.
    if (type === 'approval') return ApprovalResponseSchema.parse(value) as ApprovalResponse;
    if (type === 'ask') return AskResponseShape.parse(value) as AskResponse;
    return ChoiceResponseShape.parse(value) as ChoiceResponse;
  } catch (err) {
    if (err instanceof HitlDomainError) throw err;
    throw new ValidationError('Invalid stored response', { id, type, cause: causeOf(err) });
  }
}

function toDate(s: string | null): Date | null {
  return s ? new Date(s) : null;
}

function rowToRequest(row: HitlRequestRow): HitlRequest {
  const validated = parseRow(row, { id: row.id });
  // JSON.parse output is validated structurally by the payload schemas below.
  // this cast only names the domain metadata shape for the typed base object.
  const metadata = parseJsonField('metadata', validated.metadata, {
    id: validated.id,
  }) as HitlRequest['metadata'];
  const base = {
    id: validated.id,
    title: validated.title,
    description: validated.description,
    correlationId: validated.correlationId,
    workspaceId: validated.workspaceId,
    chatId: validated.chatId,
    executionId: validated.executionId,
    metadata,
    status: validated.status as HITLStatus,
    createdAt: new Date(validated.createdAt),
    updatedAt: new Date(validated.updatedAt),
    expiresAt: toDate(validated.expiresAt),
    resolvedAt: toDate(validated.resolvedAt),
  };
  const payload = parsePayload(validated.type, validated.payload, validated.id);
  const response = parseResponse(validated.type, validated.response, validated.id);

  if (validated.type === 'approval') {
    return {
      ...base,
      type: 'approval',
      payload: payload as ApprovalPayload,
      response: response as ApprovalResponse | null,
    };
  }
  if (validated.type === 'ask') {
    return {
      ...base,
      type: 'ask',
      payload: payload as AskPayload,
      response: response as AskResponse | null,
    };
  }
  return {
    ...base,
    type: 'choice',
    payload: payload as ChoicePayload,
    response: response as ChoiceResponse | null,
  };
}

function requestToRow(request: HitlRequest): HitlRequestRow {
  return {
    id: request.id,
    type: request.type,
    title: request.title,
    description: request.description,
    correlationId: request.correlationId,
    workspaceId: request.workspaceId,
    chatId: request.chatId,
    executionId: request.executionId,
    metadata: JSON.stringify(request.metadata),
    payload: JSON.stringify(request.payload),
    status: request.status,
    response: request.response === null ? null : JSON.stringify(request.response),
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    expiresAt: request.expiresAt?.toISOString() ?? null,
    resolvedAt: request.resolvedAt?.toISOString() ?? null,
  };
}

function patchToRow(patch: Partial<HitlRequest>): HitlRequestPatchRow {
  const row: HitlRequestPatchRow = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.correlationId !== undefined) row.correlationId = patch.correlationId;
  if (patch.workspaceId !== undefined) row.workspaceId = patch.workspaceId;
  if (patch.chatId !== undefined) row.chatId = patch.chatId;
  if (patch.executionId !== undefined) row.executionId = patch.executionId;
  if (patch.metadata !== undefined) row.metadata = JSON.stringify(patch.metadata);
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.updatedAt !== undefined) row.updatedAt = patch.updatedAt.toISOString();
  if (patch.expiresAt !== undefined) row.expiresAt = patch.expiresAt?.toISOString() ?? null;
  if (patch.resolvedAt !== undefined) row.resolvedAt = patch.resolvedAt?.toISOString() ?? null;
  if (patch.payload !== undefined) row.payload = JSON.stringify(patch.payload);
  if (patch.response !== undefined) {
    row.response = patch.response === null ? null : JSON.stringify(patch.response);
  }
  return row;
}

export class HitlRepository implements IHitlRepository {
  constructor(private readonly cold: IColdHitlStorage) {}

  async findById(id: string): Promise<HitlRequest | null> {
    const row = await this.cold.findById(id);
    return row ? rowToRequest(row) : null;
  }

  async listByStatus(status: HITLStatus): Promise<HitlRequest[]> {
    const rows = await this.cold.findManyByStatus(status);
    return rows.map(rowToRequest);
  }

  async insert(request: HitlRequest): Promise<void> {
    const row = requestToRow(request);
    try {
      hitlRequestInsertSchema.parse(row);
    } catch (err) {
      if (err instanceof HitlDomainError) throw err;
      throw new ValidationError('Invalid HITL request for insert', {
        id: request.id,
        cause: causeOf(err),
      });
    }
    await this.cold.insert(row);
  }

  async update(id: string, patch: Partial<HitlRequest>): Promise<HitlRequest> {
    const rowPatch = patchToRow(patch);
    const updated = await this.cold.update(id, rowPatch);
    return rowToRequest(updated);
  }
}
