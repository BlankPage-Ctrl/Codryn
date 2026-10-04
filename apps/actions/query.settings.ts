import type { Container } from '../bootstrap.js';
import type { SettingsQuery } from '../../src/settings/query/settings-query.types.js';

export async function querySettings(ctx: Container, params: SettingsQuery) {
  const settings = await ctx.settingsService.findMany(params);
  return settings;
}

export async function countSettings(ctx: Container, params: SettingsQuery) {
  const count = await ctx.settingsService.count(params);
  return { count };
}
