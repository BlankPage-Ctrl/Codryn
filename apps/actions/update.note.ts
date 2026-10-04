import type { Container } from '../bootstrap.js';
import type { Note, NoteUpdateInput } from '../../src/notes/index.js';
import { ValidationError, NotFoundError, AppError } from '../shared/errors.js';
import { NotesDomainError } from '../../src/notes/errors/base.js';

export async function updateNote(
  ctx: Container,
  params: { workspaceId: string; id: string; patch: NoteUpdateInput },
): Promise<Note> {
  try {
    return await ctx.notesService.update(params.id, params.workspaceId, params.patch);
  } catch (err) {
    if (err instanceof NotesDomainError) {
      if (err.code === 'VALIDATION_FAILED') throw new ValidationError(err.message);
      if (
        err.code === 'NOTE_NOT_FOUND' ||
        err.code === 'CATEGORY_NOT_FOUND' ||
        err.code === 'NOT_FOUND'
      )
        throw new NotFoundError(err.message);
      if (err.code === 'CONFLICT' || err.code === 'ALREADY_EXISTS')
        throw new AppError(409, err.message, 'CONFLICT');
      if (err.code === 'FORBIDDEN') throw new AppError(403, err.message, 'FORBIDDEN');
      throw new AppError(err.statusCode, err.message);
    }
    throw new ValidationError((err as Error).message);
  }
}
