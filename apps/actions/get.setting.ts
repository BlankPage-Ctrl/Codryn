import type { Container } from '../bootstrap.js';

export async function getSetting(
  ctx: Container,
  params: { key: string },
): Promise<{ key: string; value: string | null }> {
  const value = await ctx.settingsService.getValue(params.key);
  return { key: params.key, value };
}
