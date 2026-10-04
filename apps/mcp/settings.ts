import { workspaceKey } from '../shared/workspace-settings.js';

export const MCP_SETTING_PREFIX = 'mcp:';

export interface McpSettingsPort {
  getValue(key: string): Promise<string | null>;
  setValue(key: string, value: string): Promise<void>;
}

/** Settings KV key for one server's on/off toggle. Default ON when absent. */
export function mcpServerKey(workspaceId: string, serverName: string): string {
  return workspaceKey(workspaceId, `${MCP_SETTING_PREFIX}${serverName}`);
}

function parseEnabled(raw: string | null): boolean {
  if (raw === null || raw.trim() === '') return true;
  const v = raw.trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'off' || v === 'disabled') return false;
  return true;
}

export async function isMcpServerEnabled(
  settings: Pick<McpSettingsPort, 'getValue'>,
  workspaceId: string,
  serverName: string,
): Promise<boolean> {
  const raw = await settings.getValue(mcpServerKey(workspaceId, serverName));
  return parseEnabled(raw);
}

export async function setMcpServerEnabled(
  settings: Pick<McpSettingsPort, 'setValue'>,
  workspaceId: string,
  serverName: string,
  enabled: boolean,
): Promise<void> {
  await settings.setValue(mcpServerKey(workspaceId, serverName), enabled ? 'true' : 'false');
}
