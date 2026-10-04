import { z } from 'zod';
import type { AgentTool } from '../../../src/agent/index.js';
import { formatSkillNotFound } from './format.js';
import {
  cachedSkillMenu,
  loadSkillContent,
  sampleSkillFiles,
  type SkillLogger,
  type SkillSources,
} from '../../skills/index.js';

export const skillSchema = z.object({
  name: z.string().min(1).describe('Exact skill name from the skill list'),
});

export interface SkillToolDeps {
  /** Both skill sources (global root + project port). */
  sources: SkillSources;
  logger?: SkillLogger;
}

export function createSkillTool(deps: SkillToolDeps): AgentTool[] {
  const tool: AgentTool<typeof skillSchema> = {
    name: 'skill',
    description:
      'Load a specialized skill when the task needs it. The skill name must match one of available skills.',
    inputSchema: skillSchema,
    execute: async ({ name }) => {
      const found = await loadSkillContent(deps.sources, name, deps.logger);
      if (!found) {
        const fresh = cachedSkillMenu(deps.sources);
        return formatSkillNotFound(
          name,
          fresh.map((s) => s.name),
        );
      }
      const files = await sampleSkillFiles(found.meta.directory);
      const extraFiles =
        files.length > 0
          ? `\n**Extra files in this skill:**\n${files.map((f) => `- \`${f}\``).join('\n')}`
          : '';
      return [
        `# Skill: ${found.meta.name}`,
        '',
        found.body,
        '',
        '---',
        `**Base directory:** \`${found.meta.directory}\` — relative paths above resolve against this base directory,`,
        'not against the workspace root.',
        extraFiles,
      ].join('\n');
    },
  };

  return [tool];
}
