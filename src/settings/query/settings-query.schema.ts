import { z } from 'zod';

const SettingsFieldSchema = z.enum(['key', 'value', 'created_at', 'updated_at']);

const LengthFilterSchema = z
  .object({
    $eq: z.number().int().min(0).optional(),
    $ne: z.number().int().min(0).optional(),
    $gt: z.number().int().min(0).optional(),
    $gte: z.number().int().min(0).optional(),
    $lt: z.number().int().min(0).optional(),
    $lte: z.number().int().min(0).optional(),
    $between: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: '$length requires at least one operator' });

const StringLeafOpSchema = z.union([
  z.object({ $eq: z.string().min(1).max(500) }).strict(),
  z.object({ $ne: z.string().min(1).max(500) }).strict(),
  z.object({ $contains: z.string().min(1).max(500) }).strict(),
  z.object({ $startsWith: z.string().min(1).max(500) }).strict(),
  z.object({ $endsWith: z.string().min(1).max(500) }).strict(),
  z.object({ $wildcard: z.string().min(1).max(200) }).strict(),
  z.object({ $in: z.array(z.string().min(1).max(500)).min(1).max(50) }).strict(),
  z.object({ $nin: z.array(z.string().min(1).max(500)).min(1).max(50) }).strict(),
  z.object({ $length: LengthFilterSchema }).strict(),
]);

const RangeLeafOpSchema = z.union([
  z.object({ $gt: z.union([z.string().min(1).max(500), z.number()]) }).strict(),
  z.object({ $gte: z.union([z.string().min(1).max(500), z.number()]) }).strict(),
  z.object({ $lt: z.union([z.string().min(1).max(500), z.number()]) }).strict(),
  z.object({ $lte: z.union([z.string().min(1).max(500), z.number()]) }).strict(),
  z
    .object({
      $between: z.tuple([
        z.union([z.string().min(1).max(500), z.number()]),
        z.union([z.string().min(1).max(500), z.number()]),
      ]),
    })
    .strict(),
  z.object({ $eq: z.union([z.string().min(1).max(500), z.number()]) }).strict(),
  z.object({ $ne: z.union([z.string().min(1).max(500), z.number()]) }).strict(),
]);

const LeafConditionBase = z.object({
  field: SettingsFieldSchema,
  caseInsensitive: z.boolean().optional(),
  asNumber: z.boolean().optional(),
});

const ShorthandEqNeSchema = z.union([
  z
    .object({ field: SettingsFieldSchema, $eq: z.union([z.string().min(1).max(500), z.number()]) })
    .strict(),
  z
    .object({ field: SettingsFieldSchema, $ne: z.union([z.string().min(1).max(500), z.number()]) })
    .strict(),
]);

// Recursive condition schema
export const ConditionSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    // leaf with op (string or range)
    LeafConditionBase.extend({ op: z.union([StringLeafOpSchema, RangeLeafOpSchema]) }).strict(),
    // shorthand eq/ne
    ShorthandEqNeSchema,
    // combinators
    z.object({ $and: z.array(ConditionSchema).min(1).max(10) }).strict(),
    z.object({ $or: z.array(ConditionSchema).min(1).max(10) }).strict(),
    z.object({ $not: ConditionSchema }).strict(),
  ]),
);

export const SettingsSortSchema = z.object({
  field: SettingsFieldSchema,
  direction: z.enum(['asc', 'desc']),
});

export const SettingsQuerySchema = z
  .object({
    where: ConditionSchema.optional(),
    sort: z.array(SettingsSortSchema).max(4).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).max(10000).optional(),
  })
  .strict();

// Depth guard: reject deeply nested queries (max depth 6)
export function assertMaxDepth(condition: unknown, maxDepth = 6): void {
  function depth(node: unknown, cur: number): number {
    if (!node || typeof node !== 'object') return cur;
    const obj = node as Record<string, unknown>;
    if ('$and' in obj && Array.isArray(obj.$and)) {
      return Math.max(...(obj.$and as unknown[]).map((c) => depth(c, cur + 1)));
    }
    if ('$or' in obj && Array.isArray(obj.$or)) {
      return Math.max(...(obj.$or as unknown[]).map((c) => depth(c, cur + 1)));
    }
    if ('$not' in obj) return depth(obj.$not, cur + 1);
    return cur;
  }
  if (condition) {
    const d = depth(condition, 1);
    if (d > maxDepth) throw new Error(`Query depth ${d} exceeds max ${maxDepth}`);
  }
}

export type SettingsQueryInput = z.infer<typeof SettingsQuerySchema>;
