import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { categories } from '../categories.js';

export const categoryInsertSchema = createInsertSchema(categories);
export const categorySelectSchema = createSelectSchema(categories);
export const categoryUpdateSchema = createUpdateSchema(categories);
