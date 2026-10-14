import type { FileRepository } from '../../../src/fm/index.js';
import type { Logger } from '../../shared/types.js';
import { BUILTIN_SUBAGENTS } from './builtin.js';
import { loadProjectSubAgents, toSubAgentPort } from './project-scan.js';
import { subAgentDir, type SubAgentDef, type SubAgentWarning } from './types.js';

export interface LoadSubAgentsDeps {
  fileRepo: FileRepository;
  projectPath: string;
  logger?: Logger;
}

export interface LoadSubAgentsResult {
  agents: SubAgentDef[];
  warnings: SubAgentWarning[];
}

/** Builtin defaults first, project files override on duplicate names. Fail-open, never throws. */
export async function loadSubAgentsForWorkspace(
  deps: LoadSubAgentsDeps,
): Promise<LoadSubAgentsResult> {
  const warnings: SubAgentWarning[] = [];
  const byName = new Map<string, SubAgentDef>();
  for (const def of BUILTIN_SUBAGENTS) byName.set(def.name, def);

  let port;
  try {
    port = toSubAgentPort(deps.fileRepo, subAgentDir(deps.projectPath));
  } catch (err) {
    deps.logger?.warn({ err }, 'subagents: port init failed, using builtins only');
    return { agents: [...byName.values()], warnings };
  }

  let project: Awaited<ReturnType<typeof loadProjectSubAgents>>;
  try {
    project = await loadProjectSubAgents(port);
  } catch (err) {
    deps.logger?.warn({ err }, 'subagents: project scan failed, using builtins only');
    return { agents: [...byName.values()], warnings };
  }

  for (const { def, rel } of project) {
    if (byName.has(def.name)) {
      warnings.push({
        location: def.location,
        message: `duplicate sub-agent name "${def.name}" (${rel}) overrides builtin`,
      });
    }
    byName.set(def.name, def);
  }
  const agents = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { agents, warnings };
}

export function describeSubAgents(agents: SubAgentDef[]): string {
  return agents.map((a) => `${a.name} - ${a.description}`).join('; ');
}
