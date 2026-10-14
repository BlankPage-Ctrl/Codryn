import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { withFileLock } from '../../src/fm/utils/mutex.js';

export const TODO_DIR_REL = join('.codryn', 'todo');

export const TODO_FILE_VERSION = 1 as const;

export const TodoStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'cancelled']);
export type TodoStatus = z.infer<typeof TodoStatusSchema>;

export const TodoPrioritySchema = z.enum(['high', 'medium', 'low']);
export type TodoPriority = z.infer<typeof TodoPrioritySchema>;

export const TodoItemSchema = z.object({
  id: z.string().trim().min(1).max(64),
  content: z.string().trim().min(1).max(500),
  status: TodoStatusSchema,
  priority: TodoPrioritySchema.default('medium'),
});
export type TodoItem = z.infer<typeof TodoItemSchema>;

export const TodoFileSchema = z.object({
  version: z.literal(TODO_FILE_VERSION),
  chatId: z.string().min(1).max(64),
  workspaceId: z.string().min(1).max(64),
  todos: z.array(TodoItemSchema).max(100),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type TodoFile = z.infer<typeof TodoFileSchema>;

const CHAT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function assertSafeChatId(chatId: string): void {
  if (!CHAT_ID_PATTERN.test(chatId)) {
    throw new Error(`Invalid chatId "${chatId}": expected 1-64 chars of [A-Za-z0-9_-]`);
  }
}

function todoDirAbs(projectPath: string): string {
  return join(projectPath, TODO_DIR_REL);
}

function todoFileAbs(projectPath: string, chatId: string): string {
  return join(todoDirAbs(projectPath), `${chatId}.json`);
}

function assertNoPathTraversal(chatId: string): void {
  if (chatId.includes('/') || chatId.includes('\\') || chatId.includes('..')) {
    throw new Error(`Invalid chatId "${chatId}": path separators are not allowed`);
  }
}

function assertSingleInProgress(todos: TodoItem[]): void {
  const active = todos.filter((t) => t.status === 'in_progress');
  if (active.length > 1) {
    throw new Error(
      `Invalid todos: exactly one task may be in_progress, got ${active.length}. Mark the current one completed/cancelled first.`,
    );
  }
}

function assertUniqueIds(todos: TodoItem[]): void {
  const seen = new Set<string>();
  for (const item of todos) {
    if (seen.has(item.id)) {
      throw new Error(`Invalid todos: duplicate id "${item.id}". Each todo needs a unique id.`);
    }
    seen.add(item.id);
  }
}

export async function readTodoFile(projectPath: string, chatId: string): Promise<TodoFile | null> {
  assertSafeChatId(chatId);
  assertNoPathTraversal(chatId);
  let raw: string;
  try {
    raw = await readFile(todoFileAbs(projectPath, chatId), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Todo file for chat "${chatId}" is corrupt: invalid JSON`);
  }
  const result = TodoFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Todo file for chat "${chatId}" is corrupt: ${result.error.issues.map((i) => i.message).join(', ')}`,
    );
  }
  return result.data;
}

export interface WriteTodoInput {
  chatId: string;
  workspaceId: string;
  todos: TodoItem[];
}

export async function writeTodoFile(projectPath: string, input: WriteTodoInput): Promise<TodoFile> {
  assertSafeChatId(input.chatId);
  assertNoPathTraversal(input.chatId);
  assertUniqueIds(input.todos);
  assertSingleInProgress(input.todos);
  const abs = todoFileAbs(projectPath, input.chatId);
  return withFileLock(abs, async () => {
    const now = new Date().toISOString();
    const previous = await readTodoFile(projectPath, input.chatId).catch(() => null);
    const candidate = TodoFileSchema.parse({
      version: TODO_FILE_VERSION,
      chatId: input.chatId,
      workspaceId: input.workspaceId,
      todos: input.todos,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    });
    await mkdir(todoDirAbs(projectPath), { recursive: true });
    await writeFile(abs, JSON.stringify(candidate, null, 2), 'utf-8');
    return candidate;
  });
}

export interface UpdateTodoStatusInput {
  id: string;
  status: TodoStatus;
}

export async function updateTodoStatus(
  projectPath: string,
  chatId: string,
  patch: UpdateTodoStatusInput,
): Promise<TodoFile> {
  assertSafeChatId(chatId);
  assertNoPathTraversal(chatId);
  const abs = todoFileAbs(projectPath, chatId);
  return withFileLock(abs, async () => {
    const current = await readTodoFile(projectPath, chatId);
    if (!current) {
      throw new Error(`No todo exists for this chat yet under ${TODO_DIR_REL}.`);
    }
    const found = current.todos.find((t) => t.id === patch.id);
    if (!found) {
      throw new Error(`Todo id "${patch.id}" not found in this chat.`);
    }
    const nextTodos = current.todos.map((t) =>
      t.id === patch.id ? { ...t, status: patch.status } : t,
    );
    assertSingleInProgress(nextTodos);
    const next = TodoFileSchema.parse({
      ...current,
      todos: nextTodos,
      updatedAt: new Date().toISOString(),
    });
    await mkdir(todoDirAbs(projectPath), { recursive: true });
    await writeFile(abs, JSON.stringify(next, null, 2), 'utf-8');
    return next;
  });
}

export function isTodoComplete(file: TodoFile): boolean {
  if (file.todos.length === 0) return false;
  return file.todos.every((t) => t.status === 'completed' || t.status === 'cancelled');
}

function statusIcon(status: TodoStatus): string {
  switch (status) {
    case 'completed':
      return '[x]';
    case 'in_progress':
      return '[>]';
    case 'cancelled':
      return '[-]';
    case 'pending':
    default:
      return '[ ]';
  }
}

export function formatTodoForModel(chatId: string, file: TodoFile | null): string {
  if (!file || file.todos.length === 0) {
    return [
      `# Todos for this chat: none yet`,
      '',
      `- File: \`.codryn/todo/${chatId}.json\``,
      '',
      'Call todo_write with the full task list to start tracking.',
    ].join('\n');
  }
  const done = file.todos.filter(
    (t) => t.status === 'completed' || t.status === 'cancelled',
  ).length;
  const lines = [
    `# Todos: ${file.todos.length} tasks (${done} done)`,
    '',
    `- File: \`.codryn/todo/${chatId}.json\``,
    `- Updated: \`${file.updatedAt}\``,
    '',
  ];
  for (const item of file.todos) {
    lines.push(
      `${statusIcon(item.status)} (${item.id}) [${item.priority}] ${item.content} — ${item.status}`,
    );
  }
  return lines.join('\n');
}
