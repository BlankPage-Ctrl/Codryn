import { z } from 'zod';
import {
  listNotes,
  getNote,
  createNote,
  updateNote,
  deleteNote,
  moveNote,
  renumberNotes,
  listCategories,
  createCategory,
  renameCategory,
  deleteCategory,
} from '../../actions/index.js';
import {
  NoteCreateSchema,
  NoteUpdateSchema,
  MovePositionSchema,
  CategoryCreateSchema,
} from '../../../src/notes/index.js';
import { ListNotesQuerySchema, RenameCategorySchema } from '../../validators/note.js';
import { act, IdSchema, type StdioMethod } from './types.js';

const WorkspaceIdSchema = z.object({ workspaceId: IdSchema });

export const noteMethods: Record<string, StdioMethod> = {
  // # Note
  'list.note': {
    kind: 'plain',
    validate: (p) => WorkspaceIdSchema.merge(ListNotesQuerySchema).parse(p),
    run: act((ctx, p) => listNotes(ctx, p as Parameters<typeof listNotes>[1])),
  },
  'get.note': {
    kind: 'plain',
    validate: (p) => z.object({ workspaceId: IdSchema, id: IdSchema }).parse(p),
    run: act(getNote),
  },
  'create.note': {
    kind: 'plain',
    validate: (p) =>
      z
        .object({ workspaceId: IdSchema })
        .merge(NoteCreateSchema.omit({ workspace_id: true }))
        .parse(p),
    run: act((ctx, p) =>
      createNote(ctx, {
        workspaceId: (p as { workspaceId: string }).workspaceId,
        ...(p as object),
      } as Parameters<typeof createNote>[1]),
    ),
  },
  'update.note': {
    kind: 'plain',
    validate: (p) =>
      z.object({ workspaceId: IdSchema, id: IdSchema, patch: NoteUpdateSchema }).parse(p),
    run: act((ctx, p) => updateNote(ctx, p as Parameters<typeof updateNote>[1])),
  },
  'delete.note': {
    kind: 'plain',
    validate: (p) => z.object({ workspaceId: IdSchema, id: IdSchema }).parse(p),
    run: act(deleteNote),
  },
  'move.note': {
    kind: 'plain',
    validate: (p) =>
      z.object({ workspaceId: IdSchema, id: IdSchema, position: MovePositionSchema }).parse(p),
    run: act(moveNote),
  },
  'renumber.note': {
    kind: 'plain',
    validate: (p) => WorkspaceIdSchema.parse(p),
    run: (ctx, p) => renumberNotes(ctx, p as { workspaceId: string }),
  },

  // # Category
  'list.category': {
    kind: 'plain',
    validate: (p) => WorkspaceIdSchema.parse(p),
    run: (ctx, p) => listCategories(ctx, p as { workspaceId: string }),
  },
  'create.category': {
    kind: 'plain',
    validate: (p) =>
      z
        .object({
          workspaceId: IdSchema,
          ...CategoryCreateSchema.omit({ workspace_id: true }).shape,
        })
        .parse(p),
    run: act((ctx, p) => createCategory(ctx, p as Parameters<typeof createCategory>[1])),
  },
  'rename.category': {
    kind: 'plain',
    validate: (p) =>
      z.object({ workspaceId: IdSchema, id: IdSchema, ...RenameCategorySchema.shape }).parse(p),
    run: act(renameCategory),
  },
  'delete.category': {
    kind: 'plain',
    validate: (p) => z.object({ workspaceId: IdSchema, id: IdSchema }).parse(p),
    run: act(deleteCategory),
  },
};
