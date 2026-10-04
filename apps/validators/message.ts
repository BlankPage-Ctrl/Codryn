import { z } from 'zod';
import { findFilePartIssues } from './attachment.js';

export const MessageParamsSchema = z.object({
  workspaceId: z.string().min(1),
  chatId: z.string().min(1),
});

export const MessageUsageParamsSchema = MessageParamsSchema.extend({
  messageId: z.string().min(1),
});

export const SendMessageSchema = z.object({
  message: z
    .object({
      id: z.string(),
      role: z.literal('user'),
      // Intentionally loose: UIMessage parts are a wide union (text, tools,
      // data parts, ...). File/image rules are enforced by the refinement
      // below so other part kinds keep passing through untouched.
      parts: z.array(z.any()),
    })
    .superRefine((message, ctx) => {
      for (const found of findFilePartIssues(message.parts)) {
        ctx.addIssue({
          code: 'custom',
          message: found.message,
          path: found.path,
          input: message.parts,
        });
      }
    }),
});

export function validateMessageParams(params: unknown) {
  return MessageParamsSchema.parse(params);
}

export function validateMessageUsageParams(params: unknown) {
  return MessageUsageParamsSchema.parse(params);
}

export function validateSendMessage(body: unknown) {
  return SendMessageSchema.parse(body);
}

export const RevertMessageBodySchema = z.object({
  messageId: z.string().min(1),
  mode: z.enum(['conversation']).default('conversation'),
  restoreFiles: z.boolean().default(false),
});

export function validateRevertMessage(body: unknown) {
  return RevertMessageBodySchema.parse(body);
}

export const RevertPreviewBodySchema = z.object({
  messageId: z.string().min(1),
  mode: z.enum(['conversation']).default('conversation'),
});

export function validateRevertPreview(body: unknown) {
  return RevertPreviewBodySchema.parse(body);
}
