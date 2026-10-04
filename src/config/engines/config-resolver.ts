import { z } from 'zod';
import type { ISchemaBuilder } from '../types/index.js';

function isSchemaBuilder(val: unknown): val is ISchemaBuilder {
  return val instanceof Object && 'zod' in val && 'defaultValue' in val;
}

export function buildZodSchema(
  shape: Record<string, unknown>,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const entries: Record<string, z.ZodTypeAny> = {};

  for (const key of Object.keys(shape)) {
    const val = shape[key];

    if (isSchemaBuilder(val)) {
      let schema = val.zod;
      if (val.defaultValue !== undefined) {
        schema = schema.default(val.defaultValue) as typeof schema;
      }
      entries[key] = schema;
    } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      entries[key] = buildZodSchema(val as Record<string, unknown>);
    }
  }

  return z.object(entries);
}

export function extractDefaultsFromShape(shape: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(shape)) {
    if (isSchemaBuilder(val)) {
      if (val.defaultValue !== undefined) {
        result[key] = val.defaultValue;
      }
    } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      const nested = extractDefaultsFromShape(val as Record<string, unknown>);
      if (Object.keys(nested).length > 0) {
        result[key] = nested;
      }
    }
  }

  return result;
}
