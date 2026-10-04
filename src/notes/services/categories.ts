import {
  type Category,
  CategoryCreateSchema,
  type CategoryCreateInput,
  type ICategoriesService,
} from '../types/index.js';
import { ValidationError } from '../errors/validation.js';
import { CategoryNotFoundError } from '../errors/not-found.js';
import { ConflictError } from '../errors/conflict.js';
import { PermissionError } from '../errors/permission.js';
import type { ICategoriesRepository } from '../types/categories-repository.js';

export class CategoriesService implements ICategoriesService {
  constructor(private readonly repo: ICategoriesRepository) {}

  async list(workspaceId: string): Promise<Category[]> {
    return this.repo.list(workspaceId);
  }

  async create(
    workspaceId: string,
    input: Omit<CategoryCreateInput, 'workspace_id'> & { workspace_id?: string },
  ): Promise<Category> {
    const parsed = CategoryCreateSchema.safeParse({ ...input, workspace_id: workspaceId });
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid category: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, workspaceId },
      );
    }

    const existing = await this.repo.findByName(parsed.data.name, workspaceId);
    if (existing) {
      throw new ConflictError(`Category with name "${parsed.data.name}" already exists`, {
        name: parsed.data.name,
        workspaceId,
        existingId: existing.id,
      });
    }

    const now = new Date();
    const category: Category = {
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      name: parsed.data.name,
      color: parsed.data.color ?? null,
      is_default: false,
      created_at: now,
    };

    await this.repo.insert(category);

    return category;
  }

  async rename(id: string, workspaceId: string, name: string): Promise<Category> {
    const cat = await this.repo.findByIdAndWorkspace(id, workspaceId);
    if (!cat) throw new CategoryNotFoundError(id, { workspaceId });
    if (cat.is_default) {
      throw new PermissionError(`Cannot rename default category "${cat.name}"`, {
        id,
        workspaceId,
      });
    }

    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 40) {
      throw new ValidationError('Category name must be 1-40 characters', {
        name,
        trimmed,
        workspaceId,
      });
    }

    const existing = await this.repo.findByName(trimmed, workspaceId);
    if (existing && existing.id !== id) {
      throw new ConflictError(`Category with name "${trimmed}" already exists`, {
        name: trimmed,
        workspaceId,
        existingId: existing.id,
      });
    }

    const updated = await this.repo.update(id, { name: trimmed });

    return updated;
  }

  async findById(id: string, workspaceId: string): Promise<Category | null> {
    return this.repo.findByIdAndWorkspace(id, workspaceId);
  }

  async ensureDefault(workspaceId: string): Promise<Category> {
    return this.repo.ensureDefault(workspaceId);
  }

  async delete(id: string, workspaceId: string): Promise<void> {
    const cat = await this.repo.findByIdAndWorkspace(id, workspaceId);
    if (!cat) throw new CategoryNotFoundError(id, { workspaceId });
    if (cat.is_default) {
      throw new PermissionError(`Cannot delete default category "${cat.name}"`, {
        id,
        workspaceId,
      });
    }

    await this.repo.delete(id);
  }
}
