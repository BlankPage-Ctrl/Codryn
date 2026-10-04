import path from 'node:path';

/** A skill is a directory containing a `SKILL.md` file (Markdown with YAML frontmatter
 * carrying at least `name:` and `description:`), plus optional sibling
 * resources (`scripts/`, `references/`, ...).
 *
 * Two sources only:
 * - Global `~/.agents/skills` - scanned with plain `node:fs` (outside any
 *   workspace containment, so `fm-services` cannot reach it).
 * - Project `<projectPath>/.agents/skills` - scanned ONLY through
 *   `fm-services` scoped to the skill dir, so containment is a security
 *   guarantee: skill paths can never escape the skill root.
 *
 * Only the menu (name + one-line description) is injected into the agent's
 * system prompt. Full content is lazy-loaded through the `skill` agent tool.
 */

export interface SkillMeta {
  /** Unique skill name (from frontmatter `name:`). */
  name: string;
  description: string;
  /** Absolute path of the SKILL.md file. */
  location: string;
  directory: string;
}

export interface SkillContent extends SkillMeta {
  content: string;
  /** Up to N sibling files, as paths relative to `directory`. */
  files: string[];
}

/** `<projectPath>/.agents/skills`. Single place - never hardcode elsewhere. */
export function projectSkillDir(projectPath: string): string {
  return path.join(path.resolve(projectPath), '.agents', 'skills');
}

export interface SkillDirEntry {
  name: string;
  isDirectory: boolean;
}

export interface ProjectSkillPort {
  root: string;
  listDir(rel: string): Promise<SkillDirEntry[] | null>;
  readFile(rel: string): Promise<string | null>;
}

export interface SkillLogger {
  debug(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}
