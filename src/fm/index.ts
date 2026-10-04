export { FileRepository, GrepRepository, validateWorkspaceRoot } from './repository/index.js';

export {
  NodeFileSystem,
  NodeFileWatcher,
  GrepStorage,
  ColdFileHistoryStorage,
} from './storages/cold/index.js';

export {
  GetStatService,
  ListDirService,
  ReadFileService,
  SearchFilesService,
  GrepService,
  FileWatcherService,
  EditFileService,
  CreateFileService,
  FileRevertService,
} from './services/index.js';

export {
  FileType,
  WatchEventType,
  FileNodeSchema,
  ListDirDataSchema,
  GetStatDataSchema,
  ReadFileDataSchema,
  SearchFilesDataSchema,
  ContentLineSchema,
  type FileNode,
  type RelativePath,
  type AbsolutePath,
  type FmEncoding,
  type ReadFileInputEncoding,
  type FmMeta,
  type FmSuccess,
  type FmError,
  type FmResult,
  type ListDirData,
  type ListDirOptions,
  type GetStatData,
  type ContentLine,
  type ReadFileData,
  type ReadFileOptions,
  type SearchFilesData,
  type SearchFilesOptions,
  type WatchEvent,
} from './types/index.js';

export {
  IgnorePatternsSchema,
  IgnoreOptionsSchema,
  DEFAULT_IGNORE_PATTERNS,
  type IgnorePatterns,
  type IgnoreOptions,
  type IIgnoreFilter,
} from './types/ignore.js';

export { IgnoreFilter } from './engines/ignore.js';

export {
  EditHintSchema,
  EditOperationSchema,
  EditFileInputSchema,
  EditFileDataSchema,
  EditFailureReasonSchema,
  EditMatchSchema,
  EditFailureDetailsSchema,
  type EditHint,
  type EditOperation,
  type EditFileInput,
  type EditFileData,
  type EditFailureReason,
  type EditMatch,
  type EditFailureDetails,
} from './types/edit.js';

export {
  CreateFileInputSchema,
  CreateFileDataSchema,
  type CreateFileInput,
  type CreateFileData,
} from './types/create.js';

export {
  GrepMatchSchema,
  GrepDataSchema,
  GrepOptionsSchema,
  type GrepMatch,
  type GrepData,
  type GrepOptions,
  type RawGrepMatch,
  type GrepSearchInput,
  type GrepSearchResult,
  type IGrepStorage,
  type IGrepRepository,
  type IGrepService,
} from './types/grep.js';

export {
  parseContentToLines,
  formatWithLineNumbers,
  parseLineNumberedContent,
  toLineNumberedResult,
  detectLineEnding,
  normalizeToLf,
  type LineNumberedResult,
} from './utils/content.js';
export {
  unifiedDiff,
  withFileLock,
  hashBytes,
  compressToBlob,
  decompressBlob,
  type UnifiedDiffOptions,
  type UnifiedDiffResult,
} from './utils/index.js';

export {
  FileEditContextSchema,
  FileHistoryOpSchema,
  FileRevertRequestSchema,
  FileRestoreItemSchema,
  FileConflictWriterSchema,
  FileConflictItemSchema,
  FileRevertResultSchema,
  FileRevertPlanItemSchema,
  FileRevertPreviewSchema,
  type FileEditContext,
  type FileHistoryOp,
  type IFileHistoryStorage,
  type FileHistoryRowLike,
  type NewFileHistoryInsert,
  type FileRevertRequest,
  type FileRestoreItem,
  type FileConflictWriter,
  type FileConflictItem,
  type FileRevertResult,
  type FileRevertPlanItem,
  type FileRevertPreview,
} from './types/history.js';
export {
  fmFileHistory,
  type FileHistoryRow,
  type NewFileHistoryRow,
} from './schemas/file-history.js';

export { ErrorCodeSchema } from './types/error-codes.js';
export type { ErrorCode } from './types/error-codes.js';
export { applyEditsAtomic, EditFailedError } from './engines/edit.js';

export * from './errors/index.js';

export type { IFileSystem } from './types/file-system.js';
export type { IFileWatcher } from './types/file-watcher.js';

export {
  createFmPendingApproval,
  isFmPendingApproval,
  type FmOperation,
  type FmOutcome,
  type FmPendingApproval,
  type FmPermissionCallback,
  type FmPermissionConfirmation,
  type FmPermissionDecision,
  type FmPermissionInput,
} from './types/permission.js';

export {
  classifyWorkspacePath,
  isOutsideRelative,
  isOutsideDisplayPath,
  type WorkspacePathClassification,
} from './utils/path.js';
export { resolveOutsideTarget, type OutsideTarget } from './utils/outside.js';
