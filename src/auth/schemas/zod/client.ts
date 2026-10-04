import { createSelectSchema, createInsertSchema, createUpdateSchema } from 'drizzle-zod';
import { client } from '../client.js';

export const clientSelectSchema = createSelectSchema(client);
export const clientInsertSchema = createInsertSchema(client);
export const clientUpdateSchema = createUpdateSchema(client);
