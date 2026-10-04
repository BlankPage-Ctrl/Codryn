import { z } from 'zod';
import type { AgentTool } from '../../../src/agent/index.js';
import { cachedSkillMenu, type SkillLogger, type SkillSources } from '../../skills/index.js';

export const skillListSchema = z.object({
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Max skills to list. Defaults to all. project skills first, then alphabetical).'),
});

export interface SkillListToolDeps {
  /** Both skill sources (global root + project port). */
  sources: SkillSources;
  logger?: SkillLogger;
}

/** Flatten a description to a single line for the bullet list. */
function oneLine(text: string): string {
  return text.replace(/\r?\n/g, ' ').trim();
}

export function createSkillListTool(deps: SkillListToolDeps): AgentTool[] {
  const tool: AgentTool<typeof skillListSchema> = {
    name: 'skill_list',
    description:
      'Use this to see available skills when the task may match a skill beyond the 5 shown in the system prompt.',
    inputSchema: skillListSchema,
    execute: async ({ limit }) => {
      const menu = cachedSkillMenu(deps.sources);
      if (menu.length === 0) return 'No skills available.';
      const shown = limit !== undefined ? menu.slice(0, limit) : menu;
      const lines = shown.map((s) => `- \`${s.name}\`: ${oneLine(s.description)}`);
      if (shown.length < menu.length) {
        lines.push(`…and ${menu.length - shown.length} more — call again with a larger \`limit\`.`);
      }
      return ['## Skills', ...lines].join('\n');
    },
  };

  return [tool];
}
