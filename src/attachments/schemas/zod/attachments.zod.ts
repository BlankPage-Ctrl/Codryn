import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { attachments } from '../attachments.js';

export const attachmentInsertSchema = createInsertSchema(attachments);
export const attachmentSelectSchema = createSelectSchema(attachments);
export const attachmentUpdateSchema = createUpdateSchema(attachments);
