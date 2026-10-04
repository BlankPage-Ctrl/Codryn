import { z } from 'zod';

export interface Client {
  id: string;
  clientId: string;
  secretKey: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const ClientCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
  })
  .strict();

export type ClientCreateInput = z.infer<typeof ClientCreateSchema>;

export const ClientUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type ClientUpdateInput = z.infer<typeof ClientUpdateSchema>;
