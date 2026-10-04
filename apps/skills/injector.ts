import type { SkillMeta } from './types.js';

/**
 * Injection, hybrid bullet style.
 *
 * The host does NOT hand the full `SKILL.md` bodies to the model up front
 * (39 skills x ~5000 tokens would blow the context window). Instead:
 *
 * - Stage A (here): a compact bullet menu appended to the system prompt.
 *   The first `maxVisible` skills (project-first, alphabetical - see
 *   `registry.scanAndIndex`) carry name + one-line description; the rest are
 *   names only on a single `More (N): ...` line so no skill is ever hidden.
 *   A footer points at the `skill_list` tool for on-demand descriptions.
 * - Stage B (in `apps/agent/tools/skill-list.ts`): the `skill_list` tool
 *   returns the full name + description list in the SAME order, so "first N"
 *   means the same thing in both places.
 * - Lazy loading: the model must call the `skill` tool to get full content.
 */

/** Flatten a cell to a single line (bullets, not tables - no pipe escaping). */
function cell(text: string): string {
  return text.replace(/\r?\n/g, ' ').trim();
}

export interface SkillMenuOptions {
  /** Skills shown with descriptions before the names-only overflow line. */
  maxVisible?: number;
}

export const DEFAULT_SKILL_MENU_VISIBLE = 5;

export function buildSkillMenuPrompt(skills: SkillMeta[], opts?: SkillMenuOptions): string {
  if (skills.length === 0) return '';
  const maxVisible = opts?.maxVisible ?? DEFAULT_SKILL_MENU_VISIBLE;
  const visible = skills.slice(0, Math.max(0, maxVisible));
  const rest = skills.slice(visible.length);
  const lines = [
    '## Available Skills',
    'Skills provide specialized instructions and workflows for specific tasks.',
    'If the request matches a skill, call the `skill` tool',
    'with that skill name BEFORE acting — follow the returned instructions.',
    '',
    ...visible.map((s) => `- \`${cell(s.name)}\`: ${cell(s.description)}`),
  ];
  if (rest.length > 0) {
    lines.push(`- More (${rest.length}): ${rest.map((s) => `\`${cell(s.name)}\``).join(', ')}`);
    lines.push(
      '- Call `skill_list` (with `limit`) for descriptions of the rest, then `skill` to load one.',
    );
  }
  return lines.join('\n');
}

export function composeSystemPrompt(
  base: string | undefined,
  skills: SkillMeta[],
): string | undefined {
  const menu = buildSkillMenuPrompt(skills);
  if (!menu) return base;
  if (!base) return menu;
  return `${base}\n\n${menu}`;
}
