import type { FastifyInstance } from 'fastify';
import type { Container } from '../../bootstrap.js';
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
  validateWorkspaceId,
  validateNoteParams,
  validateCategoryParams,
  validateListNotesQuery,
  validateCreateNote,
  validateUpdateNote,
  validateMoveNote,
  validateCreateCategory,
  validateRenameCategory,
} from '../../validators/note.js';

export function registerNoteRoutes(app: FastifyInstance, ctx: Container) {
  app.get('/workspaces/:workspaceId/notes', async (req) => {
    const { workspaceId } = validateWorkspaceId(req.params);
    const query = validateListNotesQuery(req.query);
    return listNotes(ctx, { workspaceId, ...query });
  });

  app.get('/workspaces/:workspaceId/notes/:id', async (req) => {
    const { workspaceId, id } = validateNoteParams(req.params);
    return getNote(ctx, { workspaceId, id });
  });

  app.post('/workspaces/:workspaceId/notes', async (req, reply) => {
    const { workspaceId } = validateWorkspaceId(req.params);
    const input = validateCreateNote(req.body);
    const note = await createNote(ctx, { workspaceId, ...input });
    return reply.code(201).send(note);
  });

  app.patch('/workspaces/:workspaceId/notes/:id', async (req) => {
    const { workspaceId, id } = validateNoteParams(req.params);
    const patch = validateUpdateNote(req.body);
    return updateNote(ctx, { workspaceId, id, patch });
  });

  app.delete('/workspaces/:workspaceId/notes/:id', async (req, reply) => {
    const { workspaceId, id } = validateNoteParams(req.params);
    await deleteNote(ctx, { workspaceId, id });
    return reply.code(204).send();
  });

  app.post('/workspaces/:workspaceId/notes/:id/move', async (req) => {
    const { workspaceId, id } = validateNoteParams(req.params);
    const position = validateMoveNote(req.body);
    return moveNote(ctx, { workspaceId, id, position });
  });

  app.post('/workspaces/:workspaceId/notes-renumber', async (req) => {
    const { workspaceId } = validateWorkspaceId(req.params);
    return renumberNotes(ctx, { workspaceId });
  });

  app.get('/workspaces/:workspaceId/categories', async (req) => {
    const { workspaceId } = validateWorkspaceId(req.params);
    return listCategories(ctx, { workspaceId });
  });

  app.post('/workspaces/:workspaceId/categories', async (req, reply) => {
    const { workspaceId } = validateWorkspaceId(req.params);
    const input = validateCreateCategory(req.body);
    const cat = await createCategory(ctx, { workspaceId, ...input });
    return reply.code(201).send(cat);
  });

  app.patch('/workspaces/:workspaceId/categories/:id', async (req) => {
    const { workspaceId, id } = validateCategoryParams(req.params);
    const { name } = validateRenameCategory(req.body);
    return renameCategory(ctx, { workspaceId, id, name });
  });

  app.delete('/workspaces/:workspaceId/categories/:id', async (req, reply) => {
    const { workspaceId, id } = validateCategoryParams(req.params);
    await deleteCategory(ctx, { workspaceId, id });
    return reply.code(204).send();
  });
}
