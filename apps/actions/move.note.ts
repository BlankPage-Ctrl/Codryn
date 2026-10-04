import type { Container } from '../bootstrap.js';
import type { Note, MovePositionInput } from '../../src/notes/index.js';
import { ValidationError, NotFoundError, AppError } from '../shared/errors.js';
import { NotesDomainError } from '../../src/notes/errors/base.js';

export async function moveNote(
  ctx: Container,
  params: { workspaceId: string; id: string; position: MovePositionInput },
): Promise<Note> {
  try {
    return await ctx.notesService.move(params.id, params.workspaceId, params.position);
  } catch (err) {
    if (err instanceof NotesDomainError) {
      if (err.code === 'VALIDATION_FAILED') throw new ValidationError(err.message);
      if (
        err.code === 'NOTE_NOT_FOUND' ||
        err.code === 'CATEGORY_NOT_FOUND' ||
        err.code === 'NOT_FOUND'
      )
        throw new NotFoundError(err.message);
      throw new AppError(err.statusCode, err.message);
    }
    throw new ValidationError((err as Error).message);
  }
}
