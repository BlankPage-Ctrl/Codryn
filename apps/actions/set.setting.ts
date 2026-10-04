import type { Container } from '../bootstrap.js';

export async function setSetting(
  ctx: Container,
  params: { key: string; value: string },
): Promise<{ key: string; value: string }> {
  await ctx.settingsService.setValue(params.key, params.value);
  return { key: params.key, value: params.value };
}
