import { z } from 'zod';

export type Priority = 'low' | 'medium' | 'high' | 'critical';

export interface Note {
  id: string;
  workspace_id: string;
  name: string;
  category_id: string;
  desc: string;
  details: string;
  rank: string;
  priority: Priority;
  created_at: Date;
  updated_at: Date;
  version: number;
  deleted_at: Date | null;
}

export interface NoteFilter {
  category_id?: string;
  priority?: Priority | Priority[];
  search?: string;
  deleted?: boolean;
}

export interface ListOpts {
  sort?: 'rank' | 'priority' | 'updated_at' | 'created_at' | 'name';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  summary?: boolean;
}

export type MovePosition = { before?: string; after?: string };

const PrioritySchema = z.enum(['low', 'medium', 'high', 'critical']);
const NameSchema = z.string().trim().min(1).max(60);
const DescSchema = z.string().trim().max(250);
const DetailsSchema = z.string().trim().min(1).max(20_000);
const IdSchema = z.string().min(1).max(64);

export const NoteCreateSchema = z
  .object({
    workspace_id: IdSchema,
    name: NameSchema.optional().default('Untitled'),
    category_id: IdSchema.optional(),
    desc: DescSchema.optional(),
    details: DetailsSchema,
    priority: PrioritySchema.optional(),
    position: z
      .object({
        before: IdSchema.optional(),
        after: IdSchema.optional(),
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.position?.before && data.position?.after) {
      ctx.addIssue({
        code: 'custom',
        path: ['position'],
        message: 'position.before and position.after are mutually exclusive',
      });
    }
  });

export type NoteCreateInput = z.infer<typeof NoteCreateSchema>;

export const NoteUpdateSchema = z
  .object({
    name: NameSchema.optional(),
    category_id: IdSchema.optional(),
    desc: DescSchema.optional(),
    details: DetailsSchema.optional(),
    priority: PrioritySchema.optional(),
    version: z.number().int().positive(),
  })
  .strict();

export type NoteUpdateInput = z.infer<typeof NoteUpdateSchema>;

export const NoteFilterSchema = z
  .object({
    category_id: IdSchema.optional(),
    priority: z.union([PrioritySchema, z.array(PrioritySchema)]).optional(),
    search: z.string().optional(),
    deleted: z.boolean().optional(),
  })
  .strict();

export type NoteFilterInput = z.infer<typeof NoteFilterSchema>;

export const ListOptsSchema = z
  .object({
    sort: z.enum(['rank', 'priority', 'updated_at', 'created_at', 'name']).optional(),
    order: z.enum(['asc', 'desc']).optional(),
    limit: z.number().int().positive().max(1000).optional(),
    offset: z.number().int().min(0).optional(),
    summary: z.boolean().optional(),
  })
  .strict();

export type ListOptsInput = z.infer<typeof ListOptsSchema>;

export const MovePositionSchema = z
  .object({
    before: IdSchema.optional(),
    after: IdSchema.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.before && data.after) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: 'before and after are mutually exclusive',
      });
    }
    if (!data.before && !data.after) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: 'Either before or after must be provided',
      });
    }
  });

export type MovePositionInput = z.infer<typeof MovePositionSchema>;
