import { z } from 'zod';

/**
 * Provenance attached to a single edit_file / create_file tool execution.
 * Threaded from the message run (chatId/assistantMessageId/runId are known
 * at toolset build time, toolCallId at execution time).
 */
export const FileEditContextSchema = z
  .object({
    workspaceId: z.string().min(1).max(128),
    chatId: z.string().min(1).max(128),
    messageId: z.string().min(1).max(128),
    runId: z.string().min(1).max(128).optional(),
    toolCallId: z.string().min(1).max(256).optional(),
  })
  .strict();

export type FileEditContext = z.infer<typeof FileEditContextSchema>;

export const FileHistoryOpSchema = z.enum(['edit', 'create']);

export type FileHistoryOp = z.infer<typeof FileHistoryOpSchema>;

export interface IFileHistoryStorage {
  insert(row: NewFileHistoryInsert): Promise<FileHistoryRowLike>;
  listByMessageIds(chatId: string, messageIds: string[]): Promise<FileHistoryRowLike[]>;
  findLatestByWorkspacePath(workspaceId: string, path: string): Promise<FileHistoryRowLike | null>;
  deleteByMessageIds(chatId: string, messageIds: string[]): Promise<void>;
  deleteByChatId(chatId: string): Promise<void>;
}

/** Structural row shape.*/
export interface FileHistoryRowLike {
  id: number;
  workspaceId: string;
  chatId: string;
  messageId: string;
  runId: string | null;
  toolCallId: string | null;
  path: string;
  op: string;
  existedBefore: number;
  beforeHash: string | null;
  afterHash: string;
  beforeBlob: string | null;
  snapshotTruncated: number;
  diffPreview: string | null;
  createdAt: string;
}

export interface NewFileHistoryInsert {
  workspaceId: string;
  chatId: string;
  messageId: string;
  runId?: string | null;
  toolCallId?: string | null;
  path: string;
  op: FileHistoryOp;
  existedBefore: boolean;
  beforeHash?: string | null;
  afterHash: string;
  beforeBlob?: string | null;
  snapshotTruncated?: boolean;
  diffPreview?: string | null;
}

export const FileRevertRequestSchema = z
  .object({
    workspaceId: z.string().min(1).max(128),
    chatId: z.string().min(1).max(128),
    // Suffix (deleted) message ids scoping the revert - from revertFromMessage.
    // Long conversations can delete large suffixes; the cap is generous
    // because entries are just short id strings.
    messageIds: z.array(z.string().min(1).max(128)).min(1).max(5000),
    // Paths to restore even when a collision is detected.
    force: z.array(z.string().min(1).max(1024)).max(200).optional(),
  })
  .strict();

export type FileRevertRequest = z.infer<typeof FileRevertRequestSchema>;

export const FileRestoreItemSchema = z.object({
  path: z.string(),
  op: z.enum(['restored', 'deleted']),
});

export type FileRestoreItem = z.infer<typeof FileRestoreItemSchema>;

export const FileConflictWriterSchema = z.object({
  chatId: z.string(),
  messageId: z.string(),
  createdAt: z.string(),
});

export type FileConflictWriter = z.infer<typeof FileConflictWriterSchema>;

export const FileConflictItemSchema = z.object({
  path: z.string(),
  reason: z.enum(['MODIFIED_AFTER', 'NO_SNAPSHOT']),
  expectedHash: z.string().nullable(),
  currentHash: z.string().nullable(),
  lastWriter: FileConflictWriterSchema.nullable(),
  diffPreview: z.string().nullable().optional(),
});

export type FileConflictItem = z.infer<typeof FileConflictItemSchema>;

export const FileRevertResultSchema = z.object({
  restored: z.array(FileRestoreItemSchema),
  conflicts: z.array(FileConflictItemSchema),
});

export type FileRevertResult = z.infer<typeof FileRevertResultSchema>;

/**
 * Read-only revert plan for one path: what `revertFromMessages` WOULD do.
 * `status: 'ok'` means the path restores cleanly; `'conflict'` means it
 * would be skipped unless forced.
 */
export const FileRevertPlanItemSchema = z.object({
  path: z.string(),
  op: z.enum(['restored', 'deleted']),
  status: z.enum(['ok', 'conflict']),
  reason: z.enum(['MODIFIED_AFTER', 'NO_SNAPSHOT']).nullable(),
  expectedHash: z.string().nullable(),
  currentHash: z.string().nullable(),
  lastWriter: FileConflictWriterSchema.nullable(),
  diffPreview: z.string().nullable().optional(),
});

export type FileRevertPlanItem = z.infer<typeof FileRevertPlanItemSchema>;

export const FileRevertPreviewSchema = z.object({
  files: z.array(FileRevertPlanItemSchema),
});

export type FileRevertPreview = z.infer<typeof FileRevertPreviewSchema>;
