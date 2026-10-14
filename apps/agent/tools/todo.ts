import { z } from 'zod';
import type { AgentTool } from '../../../src/agent/index.js';
import {
  TODO_DIR_REL,
  TodoPrioritySchema,
  TodoStatusSchema,
  formatTodoForModel,
  readTodoFile,
  updateTodoStatus,
  writeTodoFile,
} from '../../shared/todo-store.js';

export const todoWriteSchema = z.object({
  todos: z
    .array(
      z.object({
        id: z
          .string()
          .trim()
          .min(1)
          .max(64)
          .describe('Unique id for the task, e.g. "1", "auth-model"'),
        content: z.string().trim().min(1).max(500).describe('Brief description of the task'),
        status: TodoStatusSchema.describe(
          'Current status: pending, in_progress, completed, cancelled',
        ),
        priority: TodoPrioritySchema.default('medium').describe('Priority: high, medium, low'),
      }),
    )
    .max(100)
    .describe('The complete todo list (whole replace). Keep exactly one in_progress at a time.'),
});

export const todoReadSchema = z.object({});

export const todoUpdateSchema = z.object({
  id: z.string().trim().min(1).max(64).describe('Todo id to update'),
  status: TodoStatusSchema.describe('New status for the task'),
});

export interface TodoToolDeps {
  projectPath: string;
  chatId: string;
  workspaceId: string;
}

export type TodoReadToolDeps = Pick<TodoToolDeps, 'projectPath' | 'chatId'>;

function todoError(code: string, message: string, suggestion: string): string {
  return `**Error**: \`${code}\` — ${message}\n**Suggestion**: ${suggestion}`;
}

function toStoreError(error: unknown, action: string): string {
  const message = error instanceof Error ? error.message : 'Unknown todo store failure';
  if (message.includes('No todo exists')) {
    return todoError(
      'TODO_NOT_FOUND',
      message,
      `Call todo_write first to create the todo list under ${TODO_DIR_REL}.`,
    );
  }
  if (message.includes('not found in this chat')) {
    return todoError(
      'TODO_NOT_FOUND',
      message,
      'Call todo_read to see the current ids, then retry the update.',
    );
  }
  if (message.startsWith('Invalid ')) {
    return todoError(
      'VALIDATION_FAILED',
      message,
      `Check the tool arguments and retry the ${action} call.`,
    );
  }
  return todoError(
    'TODO_STORE_ERROR',
    `${action} failed: ${message}`,
    `Retry the ${action} call. If it keeps failing, ask the user for help.`,
  );
}

export function createTodoTools(deps: TodoToolDeps): AgentTool[] {
  const writeTodos: AgentTool<typeof todoWriteSchema> = {
    name: 'todo_write',
    description:
      'Create or replace the whole todo list for this session. ' +
      'Use it to track multi-step work: set priority at creation, keep exactly one in_progress at a time, ' +
      'mark completed only after the work is really done. Each call replaces the full list.',
    inputSchema: todoWriteSchema,
    execute: async ({ todos }) => {
      try {
        const file = await writeTodoFile(deps.projectPath, {
          chatId: deps.chatId,
          workspaceId: deps.workspaceId,
          todos,
        });
        return formatTodoForModel(deps.chatId, file);
      } catch (error) {
        return toStoreError(error, 'todo_write');
      }
    },
  };

  const updateTodo: AgentTool<typeof todoUpdateSchema> = {
    name: 'todo_update',
    description:
      'Update the status of one todo in this chat (pending, in_progress, completed, cancelled). ' +
      'Use it for quick progress updates without rewriting the whole list.',
    inputSchema: todoUpdateSchema,
    execute: async ({ id, status }) => {
      try {
        const file = await updateTodoStatus(deps.projectPath, deps.chatId, { id, status });
        return formatTodoForModel(deps.chatId, file);
      } catch (error) {
        return toStoreError(error, 'todo_update');
      }
    },
  };

  return [writeTodos, updateTodo, ...createReadTodoTool(deps)];
}

export function createReadTodoTool(deps: TodoReadToolDeps): AgentTool[] {
  const readTodos: AgentTool<typeof todoReadSchema> = {
    name: 'todo_read',
    description:
      'Read the todo list for this session. ' +
      'Returns the current tasks with status and priority in Markdown.',
    inputSchema: todoReadSchema,
    execute: async () => {
      try {
        const file = await readTodoFile(deps.projectPath, deps.chatId);
        return formatTodoForModel(deps.chatId, file);
      } catch (error) {
        return toStoreError(error, 'todo_read');
      }
    },
  };

  return [readTodos];
}
