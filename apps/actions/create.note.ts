import type { Container } from '../bootstrap.js';
import type { Note } from '../../src/notes/index.js';

export async function createNote(
  ctx: Container,
  params: {
    workspaceId: string;
    name?: string;
    category_id?: string;
    desc?: string;
    details: string;
    priority?: string;
    position?: { before?: string; after?: string };
  },
): Promise<Note> {
  const { workspaceId, ...input } = params;
  return ctx.notesService.create(
    workspaceId,
    input as unknown as Parameters<Container['notesService']['create']>[1],
  );
}
