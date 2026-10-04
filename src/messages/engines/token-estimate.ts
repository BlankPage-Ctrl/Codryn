// Used ONLY for the pre-run maxInputTokens gate. Real usage numbers always
// come from the provider via normalizeStepFinish() - never from this file.
const CHARS_PER_TOKEN = 4;

/**
 * Fixed per-image estimate for the input gate.
 *
 * Why not chars/4 on the payload? an 8 MiB base64 image would estimate as
 * ~2.8M "tokens" and every legit vision request would be rejected.
 *
 * Why 1500: providers bill images by dimensions, not bytes? Well I'm basing this on my own research, so
 * please correct me if I'm wrong; however, keep in mind that these are just
 * token estimates, not concrete figures.
 * - OpenAI Model: 85 tokens (low detail) or 85 + 170 per 512px tile
 *   (high detail), i.e. roughly 1k-2k for a typical photo;
 * - Anthropic: ~(width*height)/750, i.e. ~1.3k-1.6k for a 1568px
 *   screenshot, up to ~4.8k on high-resolution tiers;
 *
 * 1500 sits in the middle of the common range. The gate is fail-open by
 * design (under-estimating just skips the early rejection; the provider
 * still enforces its real context limit), so a central value beats a
 * worst-case one that would false-reject valid requests.
 */
export const IMAGE_ESTIMATE_TOKENS = 1500;

/** Inline data payloads (data-URLs) must never be char-counted. */
function isInlineDataPayload(value: unknown): boolean {
  return typeof value === 'string' && value.length > 1024 && value.startsWith('data:');
}

/**
 * JSON length with embedded data-URL payloads scrubbed first, so a tool
 * result carrying base64 can't blow up the gate either.
 */
function jsonCharsIgnoringDataUrls(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    return json.replace(/data:[\w/+.-]+;base64,[A-Za-z0-9+/=\s]{1024,}/g, '').length;
  } catch {
    return 0;
  }
}

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.max(0, Math.round(text.length / CHARS_PER_TOKEN));
}

/** Estimate input tokens for model messages by stringifying content parts. */
export function estimateInputTokens(messages: Array<{ content?: unknown }>): number {
  let chars = 0;
  let imageTokens = 0;
  for (const msg of messages) {
    const content = (msg as { content?: unknown }).content;
    if (typeof content === 'string') {
      if (!isInlineDataPayload(content)) chars += content.length;
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part === 'string') {
          if (!isInlineDataPayload(part)) chars += part.length;
        } else if (part && typeof part === 'object') {
          const record = part as Record<string, unknown>;
          if (record.type === 'file' || record.type === 'image') {
            // Vision payload: fixed estimate, payload bytes excluded.
            imageTokens += IMAGE_ESTIMATE_TOKENS;
          } else if (typeof record.text === 'string') {
            chars += record.text.length;
          } else {
            chars += jsonCharsIgnoringDataUrls(part);
          }
        }
      }
    } else if (content != null) {
      chars += jsonCharsIgnoringDataUrls(content);
    }
  }
  return Math.max(0, Math.round(chars / CHARS_PER_TOKEN) + imageTokens);
}
