import {
  NoteCreateSchema,
  NoteUpdateSchema,
  NoteFilterSchema,
  ListOptsSchema,
  MovePositionSchema,
  type Note,
  type NoteCreateInput,
  type NoteUpdateInput,
  type NoteFilterInput,
  type ListOptsInput,
  type MovePositionInput,
  type INotesService,
} from '../types/index.js';
import { ValidationError } from '../errors/validation.js';
import { NoteNotFoundError, CategoryNotFoundError } from '../errors/not-found.js';
import { ConflictError } from '../errors/conflict.js';
import { OrderManager } from '../engines/index.js';
import type { INotesRepository } from '../types/notes-repository.js';
import type { ICategoriesRepository } from '../types/categories-repository.js';

export class NotesService implements INotesService {
  constructor(
    private readonly notesRepo: INotesRepository,
    private readonly categoryRepo: ICategoriesRepository,
  ) {}

  async create(
    workspaceId: string,
    input: Omit<NoteCreateInput, 'workspace_id'> & { workspace_id?: string },
  ): Promise<Note> {
    const parsed = NoteCreateSchema.safeParse({ ...input, workspace_id: workspaceId });
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid note: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, workspaceId },
      );
    }

    const data = parsed.data;
    const categoryId = data.category_id ?? (await this.getDefaultCategoryId(workspaceId));

    if (data.category_id) {
      const cat = await this.categoryRepo.findByIdAndWorkspace(data.category_id, workspaceId);
      if (!cat) {
        const cats = await this.categoryRepo.list(workspaceId);
        throw new CategoryNotFoundError(data.category_id, {
          categoryId: data.category_id,
          workspaceId,
          available: cats.map((c) => c.name),
        });
      }
    }

    const now = new Date();
    const allNotes = await this.notesRepo.findMany({ workspace_id: workspaceId }, { sort: 'rank' });
    const ranks = allNotes.map((n) => n.rank);

    const rank = data.position
      ? this.resolvePosition(data.position, ranks)
      : OrderManager.nextAtEnd(ranks);

    const note: Note = {
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      name: data.name,
      category_id: categoryId,
      desc: data.desc ?? '',
      details: data.details,
      rank,
      priority: data.priority ?? 'medium',
      created_at: now,
      updated_at: now,
      version: 1,
      deleted_at: null,
    };

    await this.notesRepo.insert(note);

    return note;
  }

  async getById(id: string, workspaceId: string): Promise<Note | null> {
    return this.notesRepo.findByIdAndWorkspace(id, workspaceId);
  }

  async list(workspaceId: string, filter?: NoteFilterInput, opts?: ListOptsInput): Promise<Note[]> {
    const fParsed = filter
      ? NoteFilterSchema.safeParse(filter)
      : ({ success: true, data: {} } as const);
    if (!fParsed.success) {
      throw new ValidationError(
        `Invalid filter: ${fParsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: fParsed.error.issues, filter },
      );
    }
    const oParsed = opts ? ListOptsSchema.safeParse(opts) : ({ success: true, data: {} } as const);
    if (!oParsed.success) {
      throw new ValidationError(
        `Invalid list opts: ${oParsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: oParsed.error.issues, opts },
      );
    }
    const f = (fParsed as { data: NoteFilterInput }).data ?? {};
    const o = (oParsed as { data: ListOptsInput }).data ?? {};
    return this.notesRepo.findMany({ ...f, workspace_id: workspaceId }, o);
  }

  async update(id: string, workspaceId: string, patch: NoteUpdateInput): Promise<Note> {
    const parsed = NoteUpdateSchema.safeParse(patch);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid update: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, id, workspaceId },
      );
    }

    const current = await this.notesRepo.findByIdAndWorkspace(id, workspaceId);
    if (!current) throw new NoteNotFoundError(id, { workspaceId });

    if (current.version !== parsed.data.version) {
      throw new ConflictError(
        `Version mismatch: expected ${parsed.data.version}, got ${current.version}. Re-fetch and retry.`,
        { id, expected: parsed.data.version, actual: current.version },
      );
    }

    if (parsed.data.category_id) {
      const cat = await this.categoryRepo.findByIdAndWorkspace(
        parsed.data.category_id,
        workspaceId,
      );
      if (!cat) {
        throw new CategoryNotFoundError(parsed.data.category_id, { workspaceId });
      }
    }

    const now = new Date();

    const updateData: Partial<Note> = {
      updated_at: now,
      version: current.version + 1,
    };

    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.category_id !== undefined) updateData.category_id = parsed.data.category_id;
    if (parsed.data.desc !== undefined) updateData.desc = parsed.data.desc;
    if (parsed.data.details !== undefined) updateData.details = parsed.data.details;
    if (parsed.data.priority !== undefined) updateData.priority = parsed.data.priority;

    return this.notesRepo.update(id, updateData);
  }

  async delete(id: string, workspaceId: string): Promise<void> {
    const note = await this.notesRepo.findByIdAndWorkspace(id, workspaceId);
    if (!note) throw new NoteNotFoundError(id, { workspaceId });

    const now = new Date();
    await this.notesRepo.update(id, {
      deleted_at: now,
      updated_at: now,
      version: note.version + 1,
    });
  }

  async move(id: string, workspaceId: string, position: MovePositionInput): Promise<Note> {
    const parsed = MovePositionSchema.safeParse(position);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid position: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, id, workspaceId },
      );
    }

    const note = await this.notesRepo.findByIdAndWorkspace(id, workspaceId);
    if (!note) throw new NoteNotFoundError(id, { workspaceId });

    const targetId = parsed.data.before ?? parsed.data.after;
    if (targetId) {
      const target = await this.notesRepo.findByIdAndWorkspace(targetId, workspaceId);
      if (!target) throw new NoteNotFoundError(targetId, { workspaceId });
    }

    const allNotes = await this.notesRepo.findMany({ workspace_id: workspaceId }, { sort: 'rank' });
    const otherNotes = allNotes.filter((n) => n.id !== id);
    const ranks = otherNotes.map((n) => n.rank);

    let newRank: string;
    if (parsed.data.before) {
      const beforeNote = otherNotes.find((n) => n.id === parsed.data.before);
      if (beforeNote) {
        const sorted = [...otherNotes].sort((a, b) => OrderManager.compare(a.rank, b.rank));
        const beforeIdx = sorted.indexOf(beforeNote);
        if (beforeIdx > 0) {
          newRank = OrderManager.between(sorted[beforeIdx - 1].rank, beforeNote.rank);
        } else {
          newRank = OrderManager.between(OrderManager.first(), beforeNote.rank);
        }
      } else {
        newRank = OrderManager.nextAtEnd(ranks);
      }
    } else {
      const afterNote = otherNotes.find((n) => n.id === parsed.data.after);
      if (afterNote) {
        const sorted = [...otherNotes].sort((a, b) => OrderManager.compare(a.rank, b.rank));
        const afterIdx = sorted.indexOf(afterNote);
        if (afterIdx < sorted.length - 1) {
          newRank = OrderManager.between(afterNote.rank, sorted[afterIdx + 1].rank);
        } else {
          newRank = OrderManager.nextAtEnd(ranks);
        }
      } else {
        newRank = OrderManager.nextAtEnd(ranks);
      }
    }

    const now = new Date();
    return this.notesRepo.update(id, {
      rank: newRank,
      updated_at: now,
      version: note.version + 1,
    });
  }

  async renumber(workspaceId: string): Promise<void> {
    const allNotes = await this.notesRepo.findMany({ workspace_id: workspaceId }, { sort: 'rank' });
    if (allNotes.length === 0) return;
    const newRanks = OrderManager.renumber(allNotes.map((n) => n.rank));

    const now = new Date();
    const updates = allNotes.map((note, i) => ({
      id: note.id,
      rank: newRanks[i],
      updatedAt: now,
      version: note.version + 1,
    }));
    // Atomic renumber via transaction, all or nothing
    await this.notesRepo.renumber(workspaceId, updates);
  }

  private resolvePosition(position: { before?: string; after?: string }, ranks: string[]): string {
    if (position.before) {
      const targetRank = ranks[0] ?? OrderManager.nextAtEnd(ranks);
      return OrderManager.between(OrderManager.first(), targetRank);
    }
    if (position.after) {
      const lastRank = ranks[ranks.length - 1] ?? OrderManager.first();
      return OrderManager.between(lastRank, OrderManager.nextAtEnd(ranks));
    }
    return OrderManager.nextAtEnd(ranks);
  }

  async reassignCategory(
    oldCategoryId: string,
    newCategoryId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.notesRepo.reassignCategory(oldCategoryId, newCategoryId, workspaceId);
  }

  private async getDefaultCategoryId(workspaceId: string): Promise<string> {
    const defaultCat = await this.categoryRepo.ensureDefault(workspaceId);
    return defaultCat.id;
  }
}
