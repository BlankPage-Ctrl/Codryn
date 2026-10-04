import type { Stats, Dirent, Dir } from 'node:fs';

export interface IFileSystem {
  lstat(path: string): Promise<Stats>;
  readdir(path: string, options?: { withFileTypes?: true }): Promise<string[] | Dirent[]>;
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: Buffer | string): Promise<void>;
  unlink(path: string): Promise<void>;
  mkdir(path: string, options?: { recursive: boolean }): Promise<void>;
  opendir(path: string): Promise<Dir>;
  readlink(path: string): Promise<string>;
}
