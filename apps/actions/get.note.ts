import type { Container } from '../bootstrap.js';
import type { Note } from '../../src/notes/index.js';
import { NotFoundError } from '../shared/errors.js';

export async function getNote(
  ctx: Container,
  params: { workspaceId: string; id: string },
): Promise<Note> {
  const note = await ctx.notesService.getById(params.id, params.workspaceId);
  if (!note) throw new NotFoundError(`Note ${params.id} not found`);
  return note;
}
