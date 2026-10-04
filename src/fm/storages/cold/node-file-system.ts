import fs from 'node:fs/promises';
import type { Stats, Dirent, Dir } from 'node:fs';
import type { IFileSystem } from '../../types/file-system.js';

export class NodeFileSystem implements IFileSystem {
  lstat(path: string): Promise<Stats> {
    return fs.lstat(path);
  }

  readdir(path: string, options?: { withFileTypes?: true }): Promise<string[] | Dirent[]> {
    return fs.readdir(path, options as object | undefined) as Promise<string[] | Dirent[]>;
  }

  readFile(path: string): Promise<Buffer> {
    return fs.readFile(path);
  }

  writeFile(path: string, data: Buffer | string): Promise<void> {
    return fs.writeFile(path, data);
  }

  unlink(path: string): Promise<void> {
    return fs.unlink(path);
  }

  async mkdir(path: string, options?: { recursive: boolean }): Promise<void> {
    await fs.mkdir(path, options);
  }

  opendir(path: string): Promise<Dir> {
    return fs.opendir(path);
  }

  readlink(path: string): Promise<string> {
    return fs.readlink(path);
  }
}
