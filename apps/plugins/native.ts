import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const CODRYN_MANIFEST_FILENAME = 'codryn-plugin.json';

const MAX_MANIFEST_BYTES = 64_000;
const MAX_RULES = 32;
const MAX_TOOLS = 32;

/** One declarative hook rule: data evaluated by the guard, never code. */
export const PluginHookRuleSchema = z.object({
  event: z.enum(['PreToolUse', 'PostToolUse']),
  matchTool: z.string().trim().min(1).max(64).optional(),
  matchCommand: z.string().trim().min(1).max(500).optional(),
  decision: z.enum(['allow', 'deny', 'ask']),
  message: z.string().trim().max(500).optional(),
});

export type PluginHookRule = z.infer<typeof PluginHookRuleSchema> & {
  /** Filled by the guard with the owning plugin id (never read from disk). */
  pluginId?: string;
};

export const PluginToolDeclSchema = z.object({
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().min(1).max(1_024),
  sensitive: z.boolean(),
  destructive: z.boolean().default(false),
  inputSchema: z.unknown().optional(),
});

export type PluginToolDecl = z.infer<typeof PluginToolDeclSchema>;

const PluginPermissionsSchema = z
  .object({
    shell: z.boolean().default(false),
    network: z.boolean().default(false),
    sensitive: z.boolean().default(false),
  })
  .default({ shell: false, network: false, sensitive: false });

const PluginLifecycleSchema = z
  .object({
    bootstrap: z.string().trim().min(1).max(4_000).optional(),
  })
  .default({});

const PluginLimitsSchema = z
  .object({
    maxSkills: z.number().int().min(1).max(200).default(40),
    maxSkillBytes: z.number().int().min(1_024).max(5_000_000).default(1_000_000),
  })
  .default({ maxSkills: 40, maxSkillBytes: 1_000_000 });

const PluginRuntimeSchema = z
  .object({
    command: z.string().trim().min(1).max(500),
    args: z.array(z.string().max(500)).max(16).default([]),
  })
  .optional();

export const CodrynPluginManifestSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().trim().min(1).max(120),
    version: z.string().trim().min(1).max(32),
    description: z.string().trim().min(1).max(1_024),
    author: z.string().trim().max(120).optional(),
    license: z.string().trim().max(80).optional(),
    permissions: PluginPermissionsSchema,
    lifecycle: PluginLifecycleSchema,
    limits: PluginLimitsSchema,
    runtime: PluginRuntimeSchema,
    hooks: z
      .object({
        rules: z.array(PluginHookRuleSchema).max(MAX_RULES).default([]),
      })
      .default({ rules: [] }),
    tools: z.array(PluginToolDeclSchema).max(MAX_TOOLS).default([]),
  })
  .passthrough();

export type CodrynPluginManifest = z.infer<typeof CodrynPluginManifestSchema>;

export interface ManifestLoadResult {
  manifest: CodrynPluginManifest | null;
  notices: string[];
}

/** Read and validate `codryn-plugin.json`. Never throws. */
export async function loadCodrynManifest(dir: string): Promise<ManifestLoadResult> {
  const notices: string[] = [];
  const file = path.join(dir, CODRYN_MANIFEST_FILENAME);
  let raw: string;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) return { manifest: null, notices };
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return { manifest: null, notices }; // absent manifest is normal (bare dir).
  }
  if (raw.includes('\u0000')) {
    notices.push('codryn-plugin.json contains NUL bytes and was rejected (text-only contract).');
    return { manifest: null, notices };
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    notices.push('codryn-plugin.json is not valid JSON and was ignored.');
    return { manifest: null, notices };
  }
  const parsed = CodrynPluginManifestSchema.safeParse(doc);
  if (!parsed.success) {
    notices.push('codryn-plugin.json failed validation and was ignored.');
    return { manifest: null, notices };
  }
  const rules = parsed.data.hooks.rules;
  if (rules.length >= MAX_RULES) {
    notices.push(`hook rules capped at ${MAX_RULES}.`);
  }
  return { manifest: parsed.data, notices };
}
