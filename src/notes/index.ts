// Types (domain + Zod input validation)
export type {
  Note,
  Category,
  Priority,
  NoteFilter,
  ListOpts,
  MovePosition,
  NoteCreateInput,
  NoteUpdateInput,
  CategoryCreateInput,
  NoteFilterInput,
  ListOptsInput,
  MovePositionInput,
} from './types/index.js';

export {
  NoteCreateSchema,
  NoteUpdateSchema,
  NoteFilterSchema,
  ListOptsSchema,
  MovePositionSchema,
  CategoryCreateSchema,
  ValidationError,
  NotFoundError,
  ConflictError,
  InvariantError,
  PermissionError,
} from './types/index.js';

/* Interfaces */
export type {
  INotesService,
  ICategoriesService,
  INotesRepository,
  ICategoriesRepository,
  IColdNotesStorage,
  IColdCategoriesStorage,
} from './types/index.js';

/* Drizzle schemas + drizzle-zod */
export {
  notes,
  categories,
  type NoteRow,
  type NewNoteRow,
  type CategoryRow,
  type NewCategoryRow,
} from './schemas/index.js';

export {
  noteInsertSchema,
  noteSelectSchema,
  noteUpdateSchema,
  categoryInsertSchema,
  categorySelectSchema,
  categoryUpdateSchema,
} from './schemas/zod/index.js';

export { OrderManager } from './engines/index.js';
export { ColdNotesStorage, ColdCategoriesStorage } from './storages/cold/index.js';
export { NotesRepository, CategoriesRepository } from './repository/index.js';
export { NotesService, CategoriesService } from './services/index.js';
export * from './errors/index.js';
