import { z } from 'zod';
import type { AgentTool, AgentToolExecuteOptions } from '../../../src/agent/index.js';
import type { IHitlService } from '../../../src/human-in-the-loop/index.js';
import type { HitlRequest, HitlRequestInput } from '../../../src/human-in-the-loop/index.js';
import {
  TimeoutError,
  CancelledError,
  ValidationError,
} from '../../../src/human-in-the-loop/index.js';
import { type OnRichResult, toHitlRichBody } from './rich-result.js';
import { formatHitlResult, formatHitlError } from './format.js';

const MAX_TITLE = 200;
const MAX_DESC = 5_000;

function slugify(input: string, fallback: string): string {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return s.length > 0 ? s : fallback;
}

const choiceOptionInputSchema = z.union([
  z.string().trim().min(1).max(200).describe('Shorthand option, converted to {id, title}'),
  z
    .object({
      id: z.string().trim().min(1).max(120),
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().max(2_000).optional(),
      recommended: z.preprocess(coerceBooleanish, z.boolean().optional()),
      allowCustomInput: z
        .preprocess(coerceBooleanish, z.boolean().optional())
        .describe('Allow custom text input for this option'),
    })
    .strict(),
]);

// Some models serialize array tool params as a single-key wrapper object
// (e.g. {item: [...]} or nested {item: {item: [...]}}) instead of a bare
// array. Unwrap that shape before validation so the call can proceed;
// anything else passes through untouched for zod to report normally.
const ARRAY_WRAPPER_KEYS = ['item', 'items', 'options', 'value', 'array'] as const;

function unwrapArrayish(value: unknown, depth = 0): unknown {
  if (Array.isArray(value) || depth >= 3) return value;
  if (typeof value !== 'object' || value === null) return value;
  const keys = Object.keys(value);
  if (keys.length !== 1) return value;
  const key = keys[0].toLowerCase();
  if (!(ARRAY_WRAPPER_KEYS as readonly string[]).includes(key)) return value;
  return unwrapArrayish((value as Record<string, unknown>)[keys[0]], depth + 1);
}

// Some models serialize booleans and ints as strings (e.g. recommended:
// "true", timeoutMs: "600000"). Coerce the obvious shapes before validation;
// anything else passes through untouched for zod to report normally.
function coerceBooleanish(value: unknown): unknown {
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return value;
}

function coerceNumberish(value: unknown): unknown {
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^-?\d+$/.test(s)) {
      const n = Number(s);
      if (Number.isSafeInteger(n)) return n;
    }
  }
  return value;
}

const timeoutMsSchema = z
  .preprocess(coerceNumberish, z.number().int().positive().max(3_600_000).optional())
  .describe('Wait timeout in ms');

const approvalKindSchema = z.object({
  kind: z.literal('approval').describe('Ask human to approve/reject an action'),
  title: z.string().trim().min(1).max(MAX_TITLE).describe('Short title shown in the HITL card'),
  description: z.string().trim().max(MAX_DESC).optional().describe('Context shown under the title'),
  requireReasonOnReject: z
    .preprocess(coerceBooleanish, z.boolean().optional())
    .describe('Require a reason when rejecting'),
  modificationInitialValue: z
    .string()
    .max(5_000)
    .optional()
    .describe('Editable initial value for approval'),
  modificationLabel: z.string().trim().max(100).optional(),
  modificationPlaceholder: z.string().trim().max(200).optional(),
  contextPreview: z.unknown().optional().describe('Preview data shown to the human'),
  timeoutMs: timeoutMsSchema,
  metadata: z
    .record(z.string().trim().min(1).max(120), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
});

const askKindSchema = z.object({
  kind: z.literal('ask').describe('Ask human an open-ended question'),
  title: z.string().trim().min(1).max(MAX_TITLE).describe('Question title'),
  description: z.string().trim().max(MAX_DESC).optional().describe('Details for the question'),
  placeholder: z.string().trim().max(200).optional(),
  validationRegex: z.string().trim().max(500).optional().describe('JS regex the answer must match'),
  minLength: z.preprocess(coerceNumberish, z.number().int().min(0).max(100_000).optional()),
  maxLength: z.preprocess(coerceNumberish, z.number().int().min(1).max(100_000).optional()),
  timeoutMs: timeoutMsSchema,
  metadata: z
    .record(z.string().trim().min(1).max(120), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
});

const choiceKindSchema = z.object({
  kind: z.literal('choice').describe('Ask human to pick from options'),
  title: z.string().trim().min(1).max(MAX_TITLE),
  description: z.string().trim().max(MAX_DESC).optional(),
  mode: z
    .enum(['single', 'multi', 'ranked'])
    .default('single')
    .describe('single, multi, or ranked picks'),
  options: z
    .preprocess((v) => unwrapArrayish(v), z.array(choiceOptionInputSchema).min(1).max(20))
    .describe('Options; plain strings auto-convert to {id,title}'),
  defaultSelection: z
    .preprocess((v) => unwrapArrayish(v), z.array(z.string().trim().min(1)).max(100).optional())
    .describe('Pre-selected option ids'),
  minSelect: z.preprocess(coerceNumberish, z.number().int().min(1).max(100).optional()),
  maxSelect: z.preprocess(coerceNumberish, z.number().int().min(1).max(100).optional()),
  allowOther: z
    .preprocess(coerceBooleanish, z.boolean().optional())
    .describe('Allow a custom value beyond the options'),
  timeoutMs: timeoutMsSchema,
  metadata: z
    .record(z.string().trim().min(1).max(120), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
});

export const hitlToolSchema = z.discriminatedUnion('kind', [
  approvalKindSchema,
  askKindSchema,
  choiceKindSchema,
]);

export type HitlToolInput = z.infer<typeof hitlToolSchema>;

export interface HitlToolDeps {
  chatId: string;
  workspaceId: string;
  executionId?: string;
  timeoutMs?: number;
}

export interface HitlToolOptions {
  onRichResult?: OnRichResult;
}

function normalizeChoiceOptions(
  raw: Array<
    | string
    | {
        id: string;
        title: string;
        description?: string;
        recommended?: boolean;
        allowCustomInput?: boolean;
      }
  >,
) {
  const seen = new Set<string>();
  return raw.map((entry, idx) => {
    if (typeof entry === 'string') {
      const base = slugify(entry, `option-${idx + 1}`);
      let id = base;
      let n = 2;
      while (seen.has(id)) {
        id = `${base}-${n++}`;
      }
      seen.add(id);
      return { id, title: entry.trim() };
    }
    // object case - ensure id uniqueness, keep other fields
    let id = entry.id.trim();
    if (seen.has(id)) {
      const base = id;
      let n = 2;
      while (seen.has(id)) id = `${base}-${n++}`;
    }
    seen.add(id);
    return {
      id,
      title: entry.title.trim(),
      ...(entry.description ? { description: entry.description } : {}),
      ...(entry.recommended !== undefined ? { recommended: entry.recommended } : {}),
      ...(entry.allowCustomInput !== undefined ? { allowCustomInput: entry.allowCustomInput } : {}),
    };
  });
}

function toHitlInput(
  args: HitlToolInput,
  deps: HitlToolDeps,
  toolCallId: string | null,
): HitlRequestInput {
  const common = {
    title: args.title,
    description: args.description,
    chatId: deps.chatId,
    workspaceId: deps.workspaceId,
    executionId: deps.executionId ?? toolCallId ?? undefined,
    timeoutMs: args.timeoutMs ?? deps.timeoutMs,
    metadata: {
      source: 'agent',
      kind: args.kind,
      ...(toolCallId ? { toolCallId } : {}),
      ...(args.metadata ?? {}),
    },
  };

  if (args.kind === 'approval') {
    const payload: HitlRequestInput['payload'] = {};
    if (args.requireReasonOnReject !== undefined)
      (payload as Record<string, unknown>).requireReasonOnReject = args.requireReasonOnReject;
    if (args.contextPreview !== undefined)
      (payload as Record<string, unknown>).contextPreview = args.contextPreview;
    if (args.modificationInitialValue !== undefined) {
      (payload as Record<string, unknown>).modification = {
        initialValue: args.modificationInitialValue,
        ...(args.modificationLabel ? { label: args.modificationLabel } : {}),
        ...(args.modificationPlaceholder ? { placeholder: args.modificationPlaceholder } : {}),
      };
    }
    return { type: 'approval', ...common, payload } as unknown as HitlRequestInput;
  }

  if (args.kind === 'ask') {
    const payload: Record<string, unknown> = {};
    if (args.placeholder !== undefined) payload.placeholder = args.placeholder;
    if (args.validationRegex !== undefined) payload.validationRegex = args.validationRegex;
    if (args.minLength !== undefined) payload.minLength = args.minLength;
    if (args.maxLength !== undefined) payload.maxLength = args.maxLength;
    return {
      type: 'ask',
      ...common,
      ...(Object.keys(payload).length > 0 ? { payload } : {}),
    } as unknown as HitlRequestInput;
  }

  // choice
  const normalized = normalizeChoiceOptions(
    args.options as Array<
      | string
      | {
          id: string;
          title: string;
          description?: string;
          recommended?: boolean;
          allowCustomInput?: boolean;
        }
    >,
  );
  const payload: Record<string, unknown> = {
    mode: args.mode ?? 'single',
    options: normalized,
  };
  if (args.defaultSelection !== undefined) payload.defaultSelection = args.defaultSelection;
  if (args.minSelect !== undefined) payload.minSelect = args.minSelect;
  if (args.maxSelect !== undefined) payload.maxSelect = args.maxSelect;
  if (args.allowOther !== undefined) payload.allowOther = args.allowOther;
  return { type: 'choice', ...common, payload } as unknown as HitlRequestInput;
}

function mapHitlError(err: unknown, title: string): string {
  if (err instanceof TimeoutError) {
    return formatHitlError(
      'HITL_TIMEOUT',
      err.message,
      `Request "${title}" expired — human did not respond in time. You may retry with a clearer prompt or longer timeoutMs.`,
    );
  }
  if (err instanceof CancelledError) {
    return formatHitlError(
      'HITL_CANCELLED',
      err.message,
      'Human cancelled the request. Consider rephrasing or proceeding without it.',
    );
  }
  if (err instanceof ValidationError) {
    return formatHitlError(
      'VALIDATION_FAILED',
      err.message,
      'Fix the tool arguments (check title/options shape) and retry.',
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  return formatHitlError('HITL_ERROR', msg, 'Retry or ask the user for help.');
}

export function createHitlTool(
  service: Pick<IHitlService, 'requestAndWait'>,
  deps: HitlToolDeps,
  options?: HitlToolOptions,
): AgentTool[] {
  const tool: AgentTool<typeof hitlToolSchema> = {
    name: 'request_human',
    description:
      'Ask the user something (approval, free-form answer, or pick from options). ' +
      'kind=approval|ask|choice; choice options accept plain strings.',
    inputSchema: hitlToolSchema,
    execute: async (args: HitlToolInput, toolOptions?: AgentToolExecuteOptions) => {
      const toolCallId = toolOptions?.toolCallId ?? null;
      let input: HitlRequestInput;
      try {
        input = toHitlInput(args, deps, toolCallId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return formatHitlError('VALIDATION_FAILED', msg, 'Check kind/title/options and retry.');
      }

      let result: HitlRequest;
      try {
        result = await service.requestAndWait(input);
      } catch (err) {
        return mapHitlError(err, args.title);
      }

      if (toolCallId && options?.onRichResult) {
        try {
          options.onRichResult({
            toolCallId,
            implement: 'request_human',
            body: toHitlRichBody(toolCallId, result),
          });
        } catch {
          // rich forward is best-effort
        }
      }

      return formatHitlResult(result);
    },
  };

  return [tool];
}
