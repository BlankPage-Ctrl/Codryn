import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { messages } from '../messages.js';
import { messageParts } from '../message_parts.js';
import { messageRunSteps } from '../message_run_steps.js';

export const messageInsertSchema = createInsertSchema(messages);
export const messageSelectSchema = createSelectSchema(messages);
export const messageUpdateSchema = createUpdateSchema(messages);

export const messagePartInsertSchema = createInsertSchema(messageParts);
export const messagePartSelectSchema = createSelectSchema(messageParts);
export const messagePartUpdateSchema = createUpdateSchema(messageParts);

export const runStepInsertSchema = createInsertSchema(messageRunSteps);
export const runStepSelectSchema = createSelectSchema(messageRunSteps);
