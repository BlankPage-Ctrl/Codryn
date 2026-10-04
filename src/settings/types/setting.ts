import { z } from 'zod';

export interface Setting {
  key: string;
  value: string;
  created_at: Date;
  updated_at: Date;
}

export const SettingCreateSchema = z
  .object({
    key: z.string().trim().min(1).max(100),
    value: z.string().max(5000),
  })
  .strict();

export type SettingCreateInput = z.infer<typeof SettingCreateSchema>;

export const SettingUpdateSchema = z
  .object({
    value: z.string().max(5000),
  })
  .strict();

export type SettingUpdateInput = z.infer<typeof SettingUpdateSchema>;
