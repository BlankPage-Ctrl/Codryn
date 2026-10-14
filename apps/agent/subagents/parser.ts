import path from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';
import type { SubAgentDef, SubAgentMode } from './types.js';
import {
  DEFAULT_SUBAGENT_MAX_STEPS,
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  MAX_SUBAGENT_MAX_STEPS,
} from './types.js';

const MAX_FILE_BYTES = 256_000;
const MAX_NAME_LENGTH = 64;

const NameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_NAME_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/);

const SubAgentFrontmatterSchema = z
  .object({
    name: NameSchema.optional(),
    description: z.string().trim().min(1).max(500),
    mode: z.enum(['ask', 'plan', 'edit']).optional(),
    tools: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
    disallowedTools: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
    maxSteps: z.number().int().min(1).max(MAX_SUBAGENT_MAX_STEPS).optional(),
    timeoutMs: z.number().int().min(1_000).max(600_000).optional(),
    modelHint: z.string().trim().min(1).max(200).optional(),
    model: z.string().trim().min(1).max(200).optional(),
  })
  .passthrough();

export function parseSubAgentFile(raw: string, filePath: string): SubAgentDef | null {
  const fallbackName = path.basename(filePath, path.extname(filePath));
  try {
    const parsed = matter(raw, {});
    const frontmatter = SubAgentFrontmatterSchema.safeParse(parsed.data);
    if (!frontmatter.success) return null;
    const body = parsed.content.trim();
    if (!body) return null;
    return toDef(frontmatter.data, body, filePath, fallbackName);
  } catch {
    // Strict parse failed, try the lenient fallback before giving up.
  }

  const { data, body } = splitFrontmatter(raw);
  const frontmatter = SubAgentFrontmatterSchema.safeParse(data);
  if (!frontmatter.success || !body.trim()) return null;
  return toDef(frontmatter.data, body.trim(), filePath, fallbackName);
}

function toDef(
  data: z.infer<typeof SubAgentFrontmatterSchema>,
  body: string,
  filePath: string,
  fallbackName: string,
): SubAgentDef | null {
  const rawName = data.name ?? fallbackName;
  const name = NameSchema.safeParse(rawName);
  if (!name.success) return null;
  const def: SubAgentDef = {
    name: name.data,
    description: data.description,
    mode: (data.mode ?? 'ask') as SubAgentMode,
    maxSteps: data.maxSteps ?? DEFAULT_SUBAGENT_MAX_STEPS,
    timeoutMs: data.timeoutMs ?? DEFAULT_SUBAGENT_TIMEOUT_MS,
    systemPrompt: body,
    location: filePath,
  };
  if (data.tools) def.tools = [...new Set(data.tools)];
  if (data.disallowedTools) def.disallowedTools = [...new Set(data.disallowedTools)];
  const hint = data.modelHint ?? data.model;
  if (hint) def.modelHint = hint;
  return def;
}

function splitFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { data: {}, body: normalized };
  const lines = normalized.split('\n');
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === '---' || lines[i]!.trim() === '...') {
      end = i;
      break;
    }
  }
  if (end === -1) return { data: {}, body: normalized };
  return {
    data: parseLenientYaml(lines.slice(1, end).join('\n')),
    body: lines.slice(end + 1).join('\n'),
  };
}

function parseLenientYaml(text: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#') || /^\s/.test(line)) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (!key) continue;
    let value = line.slice(colon + 1).trim();
    if (value === '|' || value === '|-') {
      data[key] = '';
      continue;
    }
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter((s) => s.length > 0);
      continue;
    }
    const num = Number(value);
    data[key] = value !== '' && Number.isFinite(num) ? num : value;
  }
  return data;
}

export { MAX_FILE_BYTES };
