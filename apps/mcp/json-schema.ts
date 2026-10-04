import { z } from 'zod';

/**
 * Minimal JSON Schema => Zod converter for MCP `tools/list` input schemas.
 *
 * MCP servers advertise `inputSchema` as JSON Schema (draft 2020-12, object
 * root). The agent needs a Zod schema for `AgentTool`. Unsupported or
 * malformed fragments degrade to `z.unknown()` - never throw here; a bad
 * third-party schema must not break the whole snapshot.
 */
export function jsonSchemaToZod(schema: unknown): z.ZodTypeAny {
  try {
    const converted = convert(schema);
    return converted ?? z.object({}).loose();
  } catch {
    return z.object({}).loose();
  }
}

function convert(schema: unknown): z.ZodTypeAny | null {
  if (typeof schema !== 'object' || schema === null) return null;
  const s = schema as Record<string, unknown>;

  if (Array.isArray(s.enum) && s.enum.length > 0 && s.enum.every((v) => typeof v === 'string')) {
    const options = s.enum as string[];
    const base = z.enum(options as [string, ...string[]]);
    return withMeta(base, s);
  }

  const type = typeof s.type === 'string' ? s.type : undefined;
  switch (type) {
    case 'string': {
      let base = z.string();
      if (typeof s.minLength === 'number') base = base.min(s.minLength) as typeof base;
      if (typeof s.maxLength === 'number') base = base.max(s.maxLength) as typeof base;
      return withMeta(base, s);
    }
    case 'number':
    case 'integer': {
      let base = type === 'integer' ? z.number().int() : z.number();
      if (typeof s.minimum === 'number') base = base.min(s.minimum) as typeof base;
      if (typeof s.maximum === 'number') base = base.max(s.maximum) as typeof base;
      return withMeta(base, s);
    }
    case 'boolean':
      return withMeta(z.boolean(), s);
    case 'array': {
      const items = convert(s.items) ?? z.unknown();
      let base = z.array(items as never);
      if (typeof s.minItems === 'number') base = base.min(s.minItems) as typeof base;
      if (typeof s.maxItems === 'number') base = base.max(s.maxItems) as typeof base;
      return withMeta(base, s);
    }
    case 'object':
    case undefined: {
      const props = (s.properties ?? {}) as Record<string, unknown>;
      const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, prop] of Object.entries(props)) {
        const field = convert(prop) ?? z.unknown();
        shape[key] = required.has(key) ? field : field.optional();
      }
      const base =
        s.additionalProperties === false ? z.object(shape).strict() : z.object(shape).loose();
      return withMeta(base, s);
    }
    default:
      return withMeta(z.unknown(), s);
  }
}

function withMeta<T extends z.ZodTypeAny>(schema: T, s: Record<string, unknown>): T {
  let out = schema;
  if (typeof s.description === 'string' && s.description) {
    out = out.describe(s.description) as T;
  }
  if ('default' in s) {
    try {
      out = (out as z.ZodTypeAny).default(s.default) as unknown as T;
    } catch {
      // default incompatible with schema - ignore
    }
  }
  return out;
}
