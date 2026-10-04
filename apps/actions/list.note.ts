import type { Container } from '../bootstrap.js';
import type { Note, NoteFilterInput, ListOptsInput, Priority } from '../../src/notes/index.js';

export interface ListNotesParams {
  category?: string;
  priority?: string;
  search?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

export async function listNotes(
  ctx: Container,
  params: ListNotesParams & { workspaceId: string },
): Promise<Note[]> {
  const filter: NoteFilterInput = {};
  if (params.category) filter.category_id = params.category;
  if (params.priority) filter.priority = params.priority as Priority;
  if (params.search) filter.search = params.search;

  const opts: ListOptsInput = {};
  if (params.sort) opts.sort = params.sort as ListOptsInput['sort'];
  if (params.order) opts.order = params.order as ListOptsInput['order'];
  if (params.limit !== undefined) opts.limit = params.limit;
  if (params.offset !== undefined) opts.offset = params.offset;

  return ctx.notesService.list(
    params.workspaceId,
    Object.keys(filter).length > 0 ? filter : undefined,
    Object.keys(opts).length > 0 ? opts : undefined,
  );
}
