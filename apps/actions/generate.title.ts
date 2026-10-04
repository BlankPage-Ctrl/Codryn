import { z } from 'zod';
import { zodSchema } from 'ai';
import type { Container } from '../bootstrap.js';
import { ValidationError } from '../shared/errors.js';
import { resolveDefaultProvider } from '../shared/model-resolver.js';
import { getDefaultProviderGlobal } from '../shared/global-settings.js';

export interface GenerateTitleParams {
  text: string;
  maxLength?: number;
}

export interface GenerateTitleResult {
  title: string;
}

const titleSchema = z.object({
  title: z.string(),
});

/**
 * Non-messaging example proving the agent facade is use-case neutral:
 * it produces structured output (`ctx.agent.object`) from an explicit resolved
 * model, with no chat, workspace, or tool registry involved.
 */
export async function generateTitle(
  ctx: Container,
  params: GenerateTitleParams,
): Promise<GenerateTitleResult> {
  if (!params.text) throw new ValidationError('text is required');

  const defaults = await getDefaultProviderGlobal(ctx);
  const resolved = await resolveDefaultProvider(ctx, defaults);
  if (!resolved.ok) throw new ValidationError(resolved.error.message);

  const result = await ctx.agent.object({
    model: resolved.data,
    system: `You write concise, descriptive titles.
Produce a JSON object matching: { "title": string }.
Title must be at most ${params.maxLength ?? 80} characters. Succinct. No punctuation at the end.`,
    prompt: params.text,
    schema: zodSchema(titleSchema),
  });

  return { title: result.object.title };
}
