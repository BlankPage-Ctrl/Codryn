import { z } from 'zod';
import type { AgentTool } from '../../../src/agent/index.js';
import {
  PLAN_DIR_REL,
  PlanStatusSchema,
  createPlanFile,
  formatPlanForModel,
  listPlanFiles,
  parsePlanFileName,
  readLatestPlan,
  readPlanFile,
  updatePlanFile,
} from '../../shared/plan-store.js';

export const writePlanSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe('Short plan title, e.g. "Add pagination to file listing"'),
  markdown: z
    .string()
    .min(1)
    .max(100_000)
    .describe(
      'Full implementation plan in Markdown. Must cover: goal, findings, proposed changes (files and steps), risks, and verification steps.',
    ),
  status: PlanStatusSchema.default('awaiting_approval').describe(
    'Plan approval status. New plans start as awaiting_approval until accepted.',
  ),
});

export const editPlanSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional().describe('Replacement plan title'),
    markdown: z
      .string()
      .min(1)
      .max(100_000)
      .optional()
      .describe('Replacement plan body in Markdown'),
    status: PlanStatusSchema.optional().describe(
      'Updated approval status, e.g. accepted once the user approves the plan',
    ),
    file: z
      .string()
      .optional()
      .describe(
        'Plan file name (<chatId>-<timestampMs>.json). Defaults to the latest plan for this chat.',
      ),
  })
  .refine(
    (value) =>
      value.title !== undefined || value.markdown !== undefined || value.status !== undefined,
    {
      message: 'Provide at least one of title, markdown, or status to update',
    },
  );

export const readPlanSchema = z.object({
  file: z
    .string()
    .optional()
    .describe(
      'Plan file name (<chatId>-<timestampMs>.json). Defaults to the latest plan for this chat.',
    ),
});

export interface PlanToolDeps {
  projectPath: string;
  chatId: string;
  workspaceId: string;
  assistantMessageId: string;
}

export type ReadPlanToolDeps = Pick<PlanToolDeps, 'projectPath' | 'chatId'>;

function planError(code: string, message: string, suggestion: string): string {
  return `**Error**: \`${code}\` — ${message}\n**Suggestion**: ${suggestion}`;
}

function toStoreError(error: unknown, action: string): string {
  const message = error instanceof Error ? error.message : 'Unknown plan store failure';
  if (message.includes('not found')) {
    return planError(
      'PLAN_NOT_FOUND',
      message,
      `Call read_plan without a file argument to load the latest plan, or write_plan to create one under ${PLAN_DIR_REL}.`,
    );
  }
  if (message.startsWith('Invalid ')) {
    return planError(
      'VALIDATION_FAILED',
      message,
      `Check the tool arguments and retry the ${action} call.`,
    );
  }
  return planError(
    'PLAN_STORE_ERROR',
    `${action} failed: ${message}`,
    `Retry the ${action} call. If it keeps failing, ask the user for help.`,
  );
}

function assertPlanBelongsToChat(file: string, chatId: string): void {
  const parsed = parsePlanFileName(file);
  if (parsed && parsed.chatId !== chatId) {
    throw new Error(
      `Invalid plan file "${file}": it belongs to another chat and cannot be accessed from this chat`,
    );
  }
}

async function resolvePlanFile(
  projectPath: string,
  chatId: string,
  file: string | undefined,
): Promise<string | null> {
  if (file) {
    assertPlanBelongsToChat(file, chatId);
    return file;
  }
  const entries = await listPlanFiles(projectPath, chatId);
  if (entries.length === 0) return null;
  return entries[entries.length - 1].file;
}

export function createPlanTools(deps: PlanToolDeps): AgentTool[] {
  const writePlan: AgentTool<typeof writePlanSchema> = {
    name: 'write_plan',
    description:
      `Write a new implementation plan file under ${PLAN_DIR_REL} as ` +
      '`<chatId>-<timestampMs>.json` (title, Markdown body, approval status). ' +
      'Use it once the investigation is complete and the plan is final. ' +
      'Each call creates a new timestamped file; the newest file is the active plan. ' +
      'Never write outside the plan directory.',
    inputSchema: writePlanSchema,
    execute: async ({ title, markdown, status }) => {
      try {
        const { file, plan } = await createPlanFile(deps.projectPath, {
          chatId: deps.chatId,
          workspaceId: deps.workspaceId,
          assistantMessageId: deps.assistantMessageId,
          title,
          markdown,
          status,
        });
        return [
          `# Plan saved: ${plan.title}`,
          '',
          `- File: \`.codryn/plan/${file}\``,
          `- Status: \`${plan.status}\``,
          `- Updated: \`${plan.updatedAt}\``,
          '',
          'The newest plan file is the active plan for this chat.',
        ].join('\n');
      } catch (error) {
        return toStoreError(error, 'write_plan');
      }
    },
  };

  const editPlan: AgentTool<typeof editPlanSchema> = {
    name: 'edit_plan',
    description:
      'Revise a plan file under `.codryn/plan/` (title, Markdown body, and/or approval status). ' +
      'Defaults to the latest plan for this chat. ' +
      'Use it to refine the plan or to mark it accepted after approval.',
    inputSchema: editPlanSchema,
    execute: async ({ title, markdown, status, file }) => {
      try {
        const target = await resolvePlanFile(deps.projectPath, deps.chatId, file);
        if (!target) {
          return planError(
            'PLAN_NOT_FOUND',
            `No plan exists for this chat yet under ${PLAN_DIR_REL}.`,
            'Call write_plan first to create the initial plan.',
          );
        }
        const { plan } = await updatePlanFile(deps.projectPath, target, {
          ...(title !== undefined ? { title } : {}),
          ...(markdown !== undefined ? { markdown } : {}),
          ...(status !== undefined ? { status } : {}),
          assistantMessageId: deps.assistantMessageId,
        });
        return [
          `# Plan updated: ${plan.title}`,
          '',
          `- File: \`.codryn/plan/${target}\``,
          `- Status: \`${plan.status}\``,
          `- Updated: \`${plan.updatedAt}\``,
        ].join('\n');
      } catch (error) {
        return toStoreError(error, 'edit_plan');
      }
    },
  };

  return [writePlan, editPlan, ...createReadPlanTool(deps)];
}

export function createReadPlanTool(deps: ReadPlanToolDeps): AgentTool[] {
  const readPlan: AgentTool<typeof readPlanSchema> = {
    name: 'read_plan',
    description:
      'Read a plan file under `.codryn/plan/` for this chat. ' +
      'Defaults to the latest (active) plan. Returns the plan metadata and Markdown body.',
    inputSchema: readPlanSchema,
    execute: async ({ file }) => {
      try {
        if (file) {
          assertPlanBelongsToChat(file, deps.chatId);
          const plan = await readPlanFile(deps.projectPath, file);
          return formatPlanForModel(file, plan);
        }
        const found = await readLatestPlan(deps.projectPath, deps.chatId);
        if (!found) {
          return planError(
            'PLAN_NOT_FOUND',
            `No plan exists for this chat yet under ${PLAN_DIR_REL}.`,
            'Ask the user to switch to Plan mode and create one with write_plan.',
          );
        }
        return formatPlanForModel(found.file, found.plan);
      } catch (error) {
        return toStoreError(error, 'read_plan');
      }
    },
  };

  return [readPlan];
}
