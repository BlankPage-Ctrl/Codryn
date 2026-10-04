import type { Container } from '../bootstrap.js';

export const WORKSPACE_SETTING_TEMPLATES: Record<
  string,
  { suffix: string; defaultValue: string | null; description: string }
> = {
  insight: {
    suffix: 'insight',
    defaultValue: 'false',
    description: 'Enable SrcInsight code intelligence for this workspace (search + graph)',
  },
};

export type WorkspaceSettingSuffix = string;

export function workspaceKey(workspaceId: string, suffix: string): string {
  return `workspace:${workspaceId}:${suffix}`;
}

export function workspaceWildcard(workspaceId: string): string {
  return `workspace:${workspaceId}:*`;
}

/**
 * Ensure all workspace settings exist for a given workspaceId. Idempotent.
 * If the template defaultValue === null, skip creation (just scaffolding).
 * If string, insert if not already present (do not overwrite).
 */
export async function ensureWorkspaceSettings(
  ctx: Pick<Container, 'settingsService' | 'logger'>,
  workspaceId: string,
): Promise<void> {
  for (const entry of Object.values(WORKSPACE_SETTING_TEMPLATES)) {
    if (entry.defaultValue === null) continue;
    const key = workspaceKey(workspaceId, entry.suffix);
    try {
      const existing = await ctx.settingsService.getValue(key);
      if (existing !== null) continue;
      await ctx.settingsService.setValue(key, entry.defaultValue);
      ctx.logger?.info?.({ key, workspaceId }, `workspace-settings: initialized ${key}`);
    } catch (err) {
      ctx.logger?.warn?.({ err, key, workspaceId }, `workspace-settings: failed to ensure ${key}`);
    }
  }
}

export async function resetWorkspaceSettings(
  ctx: Pick<Container, 'settingsService' | 'logger'>,
  workspaceId: string,
): Promise<number> {
  const wildcard = workspaceWildcard(workspaceId);
  try {
    const rows = await ctx.settingsService.findMany({
      where: { field: 'key', op: { $wildcard: wildcard } },
    });
    let reset = 0;
    for (const row of rows) {
      try {
        // Hard delete forbidden - replace with empty string ""
        await ctx.settingsService.setValue(row.key, '');
        reset++;
      } catch (err) {
        ctx.logger?.warn?.({ err, key: row.key }, `workspace-settings: failed to reset ${row.key}`);
      }
    }
    if (reset > 0)
      ctx.logger?.info?.({ workspaceId, reset }, `workspace-settings: reset ${reset} keys`);
    return reset;
  } catch (err) {
    ctx.logger?.warn?.({ err, workspaceId }, `workspace-settings: failed to list keys for reset`);
    return 0;
  }
}

/**
 * Eagerly ensure settings for all existing workspaces.
 * Loops findAll workspaces -> ensureWorkspaceSettings per id.
 */
export async function ensureAllWorkspaceSettings(
  ctx: Pick<Container, 'settingsService' | 'workspacesService' | 'logger'>,
): Promise<void> {
  try {
    const workspaces = await ctx.workspacesService.findAll();
    for (const ws of workspaces) {
      await ensureWorkspaceSettings(ctx, ws.id);
    }
    if (workspaces.length)
      ctx.logger?.info?.({ count: workspaces.length }, 'workspace-settings: eager ensure done');
  } catch (err) {
    ctx.logger?.warn?.({ err }, 'workspace-settings: eager ensure failed');
  }
}

export async function getWorkspaceSetting(
  ctx: Pick<Container, 'settingsService'>,
  workspaceId: string,
  suffix: string,
): Promise<string | null> {
  const v = await ctx.settingsService.getValue(workspaceKey(workspaceId, suffix));
  return v && v !== '' ? v : null;
}

export async function setWorkspaceSetting(
  ctx: Pick<Container, 'settingsService'>,
  workspaceId: string,
  suffix: string,
  value: string,
): Promise<void> {
  await ctx.settingsService.setValue(workspaceKey(workspaceId, suffix), value);
}
