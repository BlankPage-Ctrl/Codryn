import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'smol-toml';
import { loadToml } from '../../src/config/index.js';
import { withFileLock } from '../../src/fm/utils/mutex.js';
import {
  TerminalPolicySchema,
  defaultTerminalPolicy,
  type TerminalPolicy,
} from '../../src/shell/index.js';

export const POLICY_RELATIVE_PATH = join('.codryn', 'terminal-policy.toml');

export function loadWorkspacePolicy(workspaceRoot: string): TerminalPolicy {
  if (!existsSync(join(workspaceRoot, POLICY_RELATIVE_PATH))) {
    return defaultTerminalPolicy();
  }

  const raw = loadToml(POLICY_RELATIVE_PATH, { basePath: workspaceRoot });
  const parsed = TerminalPolicySchema.safeParse(raw);
  return parsed.success ? parsed.data : defaultTerminalPolicy();
}

function normalizePattern(pattern: string): string | null {
  const trimmed = pattern.trim();
  if (!trimmed) return null;
  if (trimmed.length > 500) return trimmed.slice(0, 500);
  return trimmed;
}

function policyAbsolutePath(workspaceRoot: string): string {
  return join(workspaceRoot, POLICY_RELATIVE_PATH);
}

async function readPolicyRaw(workspaceRoot: string): Promise<Record<string, unknown>> {
  const abs = policyAbsolutePath(workspaceRoot);
  try {
    const content = await readFile(abs, 'utf-8');
    return parse(content) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

export async function saveWorkspacePolicy(
  workspaceRoot: string,
  policy: TerminalPolicy,
): Promise<TerminalPolicy> {
  const parsed = TerminalPolicySchema.safeParse(policy);
  if (!parsed.success) {
    throw new Error(`Invalid terminal policy: ${parsed.error.message}`);
  }
  const abs = policyAbsolutePath(workspaceRoot);
  return withFileLock(abs, async () => {
    const raw = await readPolicyRaw(workspaceRoot);
    const nextRaw: Record<string, unknown> = {
      ...raw,
      mode: parsed.data.mode,
      allow: parsed.data.allow,
      ask: parsed.data.ask,
      deny: parsed.data.deny,
    };
    const content = stringify(nextRaw);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf-8');
    return parsed.data;
  });
}

export async function getWorkspaceAllowlist(workspaceRoot: string): Promise<string[]> {
  return loadWorkspacePolicy(workspaceRoot).allow;
}

export async function addWorkspaceAllowPattern(
  workspaceRoot: string,
  pattern: string,
): Promise<{ added: boolean; policy: TerminalPolicy }> {
  const normalized = normalizePattern(pattern);
  if (!normalized) throw new Error('Pattern must be non-empty');
  const abs = policyAbsolutePath(workspaceRoot);
  return withFileLock(abs, async () => {
    const raw = await readPolicyRaw(workspaceRoot);
    const current = TerminalPolicySchema.safeParse(raw);
    const policy = current.success ? current.data : defaultTerminalPolicy();
    if (policy.allow.includes(normalized)) {
      return { added: false, policy };
    }
    const next: TerminalPolicy = {
      ...policy,
      allow: [...policy.allow, normalized],
    };
    const nextRaw: Record<string, unknown> = {
      ...raw,
      mode: next.mode,
      allow: next.allow,
      ask: next.ask,
      deny: next.deny,
    };
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, stringify(nextRaw), 'utf-8');
    return { added: true, policy: next };
  });
}

export async function removeWorkspaceAllowPattern(
  workspaceRoot: string,
  pattern: string,
): Promise<{ removed: boolean; policy: TerminalPolicy }> {
  const normalized = normalizePattern(pattern);
  if (!normalized) throw new Error('Pattern must be non-empty');
  const abs = policyAbsolutePath(workspaceRoot);
  return withFileLock(abs, async () => {
    const raw = await readPolicyRaw(workspaceRoot);
    const current = TerminalPolicySchema.safeParse(raw);
    const policy = current.success ? current.data : defaultTerminalPolicy();
    const filtered = policy.allow.filter((p) => p !== normalized);
    if (filtered.length === policy.allow.length) {
      return { removed: false, policy };
    }
    const next: TerminalPolicy = { ...policy, allow: filtered };
    const nextRaw: Record<string, unknown> = {
      ...raw,
      mode: next.mode,
      allow: next.allow,
      ask: next.ask,
      deny: next.deny,
    };
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, stringify(nextRaw), 'utf-8');
    return { removed: true, policy: next };
  });
}

export async function clearWorkspaceAllowlist(workspaceRoot: string): Promise<TerminalPolicy> {
  const abs = policyAbsolutePath(workspaceRoot);
  return withFileLock(abs, async () => {
    const raw = await readPolicyRaw(workspaceRoot);
    const current = TerminalPolicySchema.safeParse(raw);
    const policy = current.success ? current.data : defaultTerminalPolicy();
    const next: TerminalPolicy = { ...policy, allow: [] };
    const nextRaw: Record<string, unknown> = {
      ...raw,
      mode: next.mode,
      allow: next.allow,
      ask: next.ask,
      deny: next.deny,
    };
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, stringify(nextRaw), 'utf-8');
    return next;
  });
}
