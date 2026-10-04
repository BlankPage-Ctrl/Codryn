import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { notes } from '../notes.js';

export const noteInsertSchema = createInsertSchema(notes);
export const noteSelectSchema = createSelectSchema(notes);
export const noteUpdateSchema = createUpdateSchema(notes);
