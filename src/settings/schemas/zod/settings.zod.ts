import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { settings } from '../settings.js';

export const settingsInsertSchema = createInsertSchema(settings);
export const settingsSelectSchema = createSelectSchema(settings);
export const settingsUpdateSchema = createUpdateSchema(settings);
