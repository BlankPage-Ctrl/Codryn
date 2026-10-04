import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { hitlRequests } from '../hitl-request.js';

export const hitlRequestInsertSchema = createInsertSchema(hitlRequests);
export const hitlRequestSelectSchema = createSelectSchema(hitlRequests);
export const hitlRequestUpdateSchema = createUpdateSchema(hitlRequests);
