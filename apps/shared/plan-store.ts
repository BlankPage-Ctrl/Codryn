import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { withFileLock } from '../../src/fm/utils/mutex.js';

export const PLAN_DIR_REL = join('.codryn', 'plan');

export const PLAN_FILE_VERSION = 1 as const;

export const PlanStatusSchema = z.enum(['draft', 'awaiting_approval', 'accepted']);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

export const PlanFileSchema = z.object({
  version: z.literal(PLAN_FILE_VERSION),
  chatId: z.string().min(1).max(64),
  workspaceId: z.string().min(1).max(64),
  assistantMessageId: z.string().min(1).max(128),
  title: z.string().trim().min(1).max(200),
  markdown: z.string().min(1).max(100_000),
  status: PlanStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type PlanFile = z.infer<typeof PlanFileSchema>;

export interface PlanListEntry {
  file: string;
  timestampMs: number;
}

export interface PlanMeta {
  file: string;
  chatId: string;
  title: string;
  status: PlanStatus;
  createdAt: string;
  updatedAt: string;
}

const CHAT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function assertSafeChatId(chatId: string): void {
  if (!CHAT_ID_PATTERN.test(chatId)) {
    throw new Error(`Invalid chatId "${chatId}": expected 1-64 chars of [A-Za-z0-9_-]`);
  }
}

function planDirAbs(projectPath: string): string {
  return join(projectPath, PLAN_DIR_REL);
}

function planFileAbs(projectPath: string, file: string): string {
  return join(planDirAbs(projectPath), file);
}

export function buildPlanFileName(chatId: string, timestampMs: number): string {
  assertSafeChatId(chatId);
  const ts = Math.trunc(timestampMs);
  if (!Number.isFinite(ts) || ts <= 0) {
    throw new Error(`Invalid timestamp "${timestampMs}": expected a positive epoch millis`);
  }
  return `${chatId}-${ts}.json`;
}

export function parsePlanFileName(file: string): { chatId: string; timestampMs: number } | null {
  if (!file.endsWith('.json')) return null;
  const stem = file.slice(0, -'.json'.length);
  const sep = stem.lastIndexOf('-');
  if (sep <= 0) return null;
  const chatId = stem.slice(0, sep);
  const timestampMs = Number(stem.slice(sep + 1));
  if (!CHAT_ID_PATTERN.test(chatId)) return null;
  if (!Number.isInteger(timestampMs) || timestampMs <= 0) return null;
  return { chatId, timestampMs };
}

function isSafePlanFileName(file: string): boolean {
  if (file.includes('/') || file.includes('\\') || file.includes('..')) return false;
  return parsePlanFileName(file) !== null;
}

function assertSafePlanFileName(file: string): void {
  if (!isSafePlanFileName(file)) {
    throw new Error(
      `Invalid plan file "${file}": expected "<chatId>-<timestampMs>.json" inside ${PLAN_DIR_REL}`,
    );
  }
}

export async function listPlanFiles(projectPath: string, chatId: string): Promise<PlanListEntry[]> {
  assertSafeChatId(chatId);
  let entries: string[];
  try {
    entries = await readdir(planDirAbs(projectPath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .map((file) => ({ file, parsed: parsePlanFileName(file) }))
    .filter(
      (entry): entry is { file: string; parsed: { chatId: string; timestampMs: number } } =>
        entry.parsed !== null && entry.parsed.chatId === chatId,
    )
    .map((entry) => ({ file: entry.file, timestampMs: entry.parsed.timestampMs }))
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

export async function readPlanFile(projectPath: string, file: string): Promise<PlanFile> {
  assertSafePlanFileName(file);
  const abs = planFileAbs(projectPath, file);
  let raw: string;
  try {
    raw = await readFile(abs, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Plan file "${file}" not found in ${PLAN_DIR_REL}`, { cause: err });
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Plan file "${file}" is corrupt: invalid JSON`);
  }
  const result = PlanFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Plan file "${file}" is corrupt: ${result.error.issues.map((i) => i.message).join(', ')}`,
    );
  }
  return result.data;
}

export async function readLatestPlan(
  projectPath: string,
  chatId: string,
): Promise<{ file: string; plan: PlanFile } | null> {
  const entries = await listPlanFiles(projectPath, chatId);
  if (entries.length === 0) return null;
  const latest = entries[entries.length - 1];
  // SAFE: entries come from listPlanFiles which only yields parsed names
  const plan = await readPlanFile(projectPath, latest.file);
  return { file: latest.file, plan };
}

export async function findLatestPlanMeta(
  projectPath: string,
  chatId: string,
): Promise<PlanMeta | null> {
  const found = await readLatestPlan(projectPath, chatId);
  if (!found) return null;
  return toPlanMeta(found.file, found.plan);
}

export function toPlanMeta(file: string, plan: PlanFile): PlanMeta {
  return {
    file,
    chatId: plan.chatId,
    title: plan.title,
    status: plan.status,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

export interface CreatePlanInput {
  chatId: string;
  workspaceId: string;
  assistantMessageId: string;
  title: string;
  markdown: string;
  status?: PlanStatus;
}

export async function createPlanFile(
  projectPath: string,
  input: CreatePlanInput,
): Promise<{ file: string; plan: PlanFile }> {
  assertSafeChatId(input.chatId);
  const now = new Date().toISOString();
  const file = buildPlanFileName(input.chatId, Date.now());
  const candidate = PlanFileSchema.parse({
    version: PLAN_FILE_VERSION,
    chatId: input.chatId,
    workspaceId: input.workspaceId,
    assistantMessageId: input.assistantMessageId,
    title: input.title,
    markdown: input.markdown,
    status: input.status ?? 'awaiting_approval',
    createdAt: now,
    updatedAt: now,
  });
  const abs = planFileAbs(projectPath, file);
  await withFileLock(abs, async () => {
    await mkdir(planDirAbs(projectPath), { recursive: true });
    await writeFile(abs, JSON.stringify(candidate, null, 2), 'utf-8');
  });
  return { file, plan: candidate };
}

export interface UpdatePlanInput {
  title?: string;
  markdown?: string;
  status?: PlanStatus;
  assistantMessageId?: string;
}

export async function updatePlanFile(
  projectPath: string,
  file: string,
  patch: UpdatePlanInput,
): Promise<{ file: string; plan: PlanFile }> {
  assertSafePlanFileName(file);
  const abs = planFileAbs(projectPath, file);
  return withFileLock(abs, async () => {
    const current = await readPlanFile(projectPath, file);
    const next = PlanFileSchema.parse({
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.markdown !== undefined ? { markdown: patch.markdown } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.assistantMessageId !== undefined
        ? { assistantMessageId: patch.assistantMessageId }
        : {}),
      updatedAt: new Date().toISOString(),
    });
    await mkdir(planDirAbs(projectPath), { recursive: true });
    await writeFile(abs, JSON.stringify(next, null, 2), 'utf-8');
    return { file, plan: next };
  });
}

export function formatPlanForModel(file: string, plan: PlanFile): string {
  return [
    `# Plan: ${plan.title}`,
    '',
    `- File: \`.codryn/plan/${file}\``,
    `- Status: \`${plan.status}\``,
    `- Updated: \`${plan.updatedAt}\``,
    `- Created: \`${plan.createdAt}\``,
    '',
    plan.markdown,
  ].join('\n');
}
