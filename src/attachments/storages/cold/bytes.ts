import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { IAttachmentBytesStorage } from '../../types/attachment.js';
import { StorageReadError, StorageWriteError } from '../../errors/storage.js';
import { AttachmentsDomainError } from '../../errors/base.js';

/**
 * Filesystem byte store rooted at `<configBase>/attachments`.
 * Layout: `<root>/<workspaceId>/<storedFilename>`.
 * `storedFilename` always comes from our own DB row (never from user input),
 * but the workspace segment is still contained defensively.
 */
export class FileAttachmentBytesStorage implements IAttachmentBytesStorage {
  constructor(private readonly rootDir: string) {}

  async write(workspaceId: string, storedFilename: string, bytes: Uint8Array): Promise<void> {
    const dir = this.workspaceDir(workspaceId);
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, storedFilename), bytes);
    } catch (err) {
      if (err instanceof AttachmentsDomainError) throw err;
      throw new StorageWriteError('attachment-bytes', err, { workspaceId });
    }
  }

  async read(workspaceId: string, storedFilename: string): Promise<Buffer> {
    try {
      return await readFile(join(this.workspaceDir(workspaceId), storedFilename));
    } catch (err) {
      if (err instanceof AttachmentsDomainError) throw err;
      throw new StorageReadError('attachment-bytes', err, { workspaceId });
    }
  }

  async remove(workspaceId: string, storedFilename: string): Promise<void> {
    try {
      await rm(join(this.workspaceDir(workspaceId), storedFilename), { force: true });
    } catch (err) {
      if (err instanceof AttachmentsDomainError) throw err;
      throw new StorageWriteError('attachment-bytes', err, { workspaceId });
    }
  }

  private workspaceDir(workspaceId: string): string {
    const dir = resolve(join(this.rootDir, workspaceId));
    const root = resolve(this.rootDir) + sep;
    if (dir !== resolve(this.rootDir) && !dir.startsWith(root)) {
      throw new StorageWriteError('attachment-bytes', new Error('workspace escapes storage root'), {
        workspaceId,
      });
    }
    return dir;
  }
}
