import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { chats } from '../chat.js';

export const chatInsertSchema = createInsertSchema(chats);
export const chatSelectSchema = createSelectSchema(chats);
export const chatUpdateSchema = createUpdateSchema(chats);
