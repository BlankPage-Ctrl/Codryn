import type { Container } from '../bootstrap.js';
import { ValidationError } from '../shared/errors.js';
import { resolveDefaultProvider } from '../shared/model-resolver.js';
import { getDefaultProviderGlobal } from '../shared/global-settings.js';

export interface AutocorrectParams {
  text: string;
}

export interface AutocorrectResult {
  corrected: boolean;
  text: string;
}

/**
 * Non-messaging example proving the agent facade scale for a single-shot
 * plain-text job (`ctx.agent.generate`) with no tools, chat, or streaming UX.
 */
export async function autocorrect(
  ctx: Container,
  params: AutocorrectParams,
): Promise<AutocorrectResult> {
  if (!params.text) throw new ValidationError('text is required');

  const defaults = await getDefaultProviderGlobal(ctx);
  const resolved = await resolveDefaultProvider(ctx, defaults);
  if (!resolved.ok) throw new ValidationError(resolved.error.message);

  const result = await ctx.agent.generate({
    model: resolved.data,
    system:
      'You fix spelling, grammar, and punctuation. Return ONLY the corrected text — no explanations, no quotes.',
    prompt: params.text,
  });

  const correctedText = result.text;
  return { corrected: correctedText.trim() !== params.text.trim(), text: correctedText };
}
