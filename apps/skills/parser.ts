import { promises as fs } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';
import type { SkillMeta } from './types.js';

const MAX_SKILL_FILE_BYTES = 1_000_000;
const MAX_SIBLING_FILES = 10;

/** Frontmatter contract: only `name` + `description` matter, rest passes through. */
const SkillFrontmatterSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
  })
  .passthrough();

/**
 * Parsing: from raw `SKILL.md` text to structured data.
 *
 * Proven parser first, lenient fallback second:
 * 1. `gray-matter` (frontmatter split + strict YAML) - the production-proven
 *    path, same library the reference host implementation uses.
 * 2. On throw (strict YAML chokes on sloppy real-world skills, e.g.
 *    `description: A: B` unquoted), fall back to the lenient line parser
 *    below, which takes the first `:` as separator and keeps the rest
 *    verbatim - so messy skills still load instead of being dropped.
 * 3. `name` + `description` validated with zod; anything else is skipped
 *    silent.
 */
export function parseSkillFile(
  raw: string,
  filePath: string,
): (SkillMeta & { content: string }) | null {
  const directory = path.dirname(filePath);

  try {
    // NOTE: always pass an options object (even empty). gray-matter keeps a
    // content-keyed global cache that is populated BEFORE parsing - if the
    // strict parse throws, later calls return the cached unparsed file
    // ({data: {}}) instead of throwing, silently killing the fallback below.
    // Any options value disables the cache; {} preserves default behavior.
    const parsed = matter(raw, {});
    const frontmatter = SkillFrontmatterSchema.safeParse(parsed.data);
    if (!frontmatter.success) return null;
    return {
      name: frontmatter.data.name,
      description: frontmatter.data.description,
      location: filePath,
      directory,
      content: parsed.content.trim(),
    };
  } catch {
    // Strict parse failed - try the lenient fallback before giving up.
  }

  const { data, body } = splitFrontmatter(raw);
  const frontmatter = SkillFrontmatterSchema.safeParse(data);
  if (!frontmatter.success) return null;
  return {
    name: frontmatter.data.name,
    description: frontmatter.data.description,
    location: filePath,
    directory,
    content: body.trim(),
  };
}

/** Split `---\n<yaml>\n---\n<body>` for the lenient fallback path only. */
function splitFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { data: {}, body: normalized };
  }
  const lines = normalized.split('\n');
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === '---' || lines[i]!.trim() === '...') {
      end = i;
      break;
    }
  }
  if (end === -1) return { data: {}, body: normalized };

  const yamlText = lines.slice(1, end).join('\n');
  const body = lines.slice(end + 1).join('\n');
  return { data: parseLenientYaml(yamlText), body };
}

/**
 * Lenient YAML-subset fallback: flat `key: value` pairs + `|` block scalars.
 * First `:` wins, the rest is kept verbatim - deliberately tolerant where a
 * strict parser throws.
 */
function parseLenientYaml(text: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || line.trim().startsWith('#')) continue;
    // Only top-level keys (no indent).
    if (/^\s/.test(line)) continue;

    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (!key) continue;
    let value = line.slice(colon + 1);

    const blockMarker = value.trim();
    if (blockMarker === '|' || blockMarker === '|-') {
      // Block scalar: consume following indented lines.
      const collected: string[] = [];
      while (i + 1 < lines.length && /^\s/.test(lines[i + 1]!)) {
        collected.push(lines[++i]!.replace(/^ {1,2}/, ''));
      }
      const joined = collected.join('\n');
      data[key] = blockMarker === '|' ? `${joined}\n` : joined;
      continue;
    }

    value = value.trim();
    // Strip matching single/double quotes.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }

  return data;
}

export async function loadSkillFile(
  filePath: string,
): Promise<(SkillMeta & { content: string }) | null> {
  let raw: string;
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_SKILL_FILE_BYTES) return null;
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return null; // deleted/unreadable between scan and load - skip silent.
  }
  try {
    return parseSkillFile(raw, filePath);
  } catch {
    return null;
  }
}

/**
 * Ripgrep-style sampling: list up to `MAX_SIBLING_FILES` sibling files in the
 * skill directory (excluding `SKILL.md`) so the model knows about extra
 * resources (`scripts/`, `references/`). Shallow (one level) on purpose.
 */
export async function sampleSkillFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = entries
    .filter((e) => e.name !== 'SKILL.md' && (e.isFile() || e.isDirectory()))
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .sort()
    .slice(0, MAX_SIBLING_FILES);
  return names;
}
