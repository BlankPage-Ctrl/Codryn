import type {
  Note,
  NoteCreateInput,
  NoteUpdateInput,
  NoteFilterInput,
  ListOptsInput,
  MovePositionInput,
} from './note.js';

export interface INotesService {
  create(
    workspaceId: string,
    input: Omit<NoteCreateInput, 'workspace_id'> & { workspace_id?: string },
  ): Promise<Note>;
  getById(id: string, workspaceId: string): Promise<Note | null>;
  list(workspaceId: string, filter?: NoteFilterInput, opts?: ListOptsInput): Promise<Note[]>;
  update(id: string, workspaceId: string, patch: NoteUpdateInput): Promise<Note>;
  delete(id: string, workspaceId: string): Promise<void>;
  move(id: string, workspaceId: string, position: MovePositionInput): Promise<Note>;
  renumber(workspaceId: string): Promise<void>;
  reassignCategory(
    oldCategoryId: string,
    newCategoryId: string,
    workspaceId: string,
  ): Promise<void>;
}
