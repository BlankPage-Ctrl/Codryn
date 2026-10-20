import type { AgentTool } from '../../../src/agent/index.js';
import { DELEGATE_TOOL_NAME, type SubAgentDef } from './types.js';

const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'list_files',
  'read_file',
  'grep',
  'insight_search',
  'insight_graph',
  'insight_trace',
  'skill',
  'skill_list',
  'read_plan',
]);

const PLAN_WRITE_TOOLS: ReadonlySet<string> = new Set(['write_plan', 'edit_plan']);

// A child may always ask the human. The request reaches the parent and the
// child, and the first answer closes it for both.
const CHILD_ALWAYS_TOOLS: ReadonlySet<string> = new Set(['request_human']);

// A hidden child must never delegate further. The parent owns the delegation
// and depth is capped at one level.
const NEVER_CHILD_TOOLS: ReadonlySet<string> = new Set([DELEGATE_TOOL_NAME]);

function modeDefaults(mode: SubAgentDef['mode'], names: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const name of names) {
    if (NEVER_CHILD_TOOLS.has(name)) continue;
    if (CHILD_ALWAYS_TOOLS.has(name)) {
      out.add(name);
      continue;
    }
    if (READ_ONLY_TOOLS.has(name)) {
      out.add(name);
      continue;
    }
    if (mode === 'edit') {
      out.add(name);
      continue;
    }
    if (mode === 'plan' && PLAN_WRITE_TOOLS.has(name)) out.add(name);
  }
  return out;
}

function matchesPattern(pattern: string, name: string): boolean {
  const trimmed = pattern.trim();
  if (trimmed.endsWith('*')) return name.startsWith(trimmed.slice(0, -1));
  return trimmed === name;
}

function matchesAny(patterns: string[], name: string): boolean {
  return patterns.some((p) => matchesPattern(p, name));
}

/** Subset of parent tools a child may use. Never includes the delegate tool itself. */
export function filterChildTools(all: AgentTool[], def: SubAgentDef): AgentTool[] {
  const names = new Set(all.map((t) => t.name));
  // An explicit allowlist overrides the mode default, so MCP and plugin
  // tools (unknown at authoring time) can be granted per sub-agent with
  // exact names or `prefix__*` wildcards. The human stays reachable so a
  // child can ask a question, and the delegate tool stays unreachable
  // regardless of what the frontmatter asks for.
  const allowed =
    def.tools && def.tools.length > 0
      ? new Set(
          [...names].filter(
            (name) =>
              !NEVER_CHILD_TOOLS.has(name) &&
              (CHILD_ALWAYS_TOOLS.has(name) || matchesAny(def.tools!, name)),
          ),
        )
      : modeDefaults(def.mode, names);
  if (def.disallowedTools) {
    for (const name of [...allowed]) {
      if (matchesAny(def.disallowedTools, name)) allowed.delete(name);
    }
  }
  return all.filter((t) => allowed.has(t.name));
}
