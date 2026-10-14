import { RunInvalidError } from '../errors/validation.js';

export const SUB_RUN_KEY_PREFIX = 'sub:';

function assertComponent(value: string, label: string): void {
  if (!value || value.includes(':')) {
    throw new RunInvalidError(`Invalid sub-run key component: ${label}`, { label });
  }
}

export function toSubRunKey(parentRunId: string, toolCallId: string): string {
  assertComponent(parentRunId, 'parentRunId');
  assertComponent(toolCallId, 'toolCallId');
  return `${SUB_RUN_KEY_PREFIX}${parentRunId}:${toolCallId}`;
}

export function parseSubRunKey(key: string): { parentRunId: string; toolCallId: string } | null {
  if (!key.startsWith(SUB_RUN_KEY_PREFIX)) return null;
  const rest = key.slice(SUB_RUN_KEY_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep <= 0 || sep === rest.length - 1) return null;
  return { parentRunId: rest.slice(0, sep), toolCallId: rest.slice(sep + 1) };
}

export function isSubRunKey(key: string): boolean {
  return parseSubRunKey(key) !== null;
}
