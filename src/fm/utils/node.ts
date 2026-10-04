import type { Stats } from 'node:fs';
import path from 'node:path';
import { generateNodeId } from './id.js';
import { FileType, type FileNode } from '../types/index.js';
import { toRelativePath } from './path.js';

export function buildFileNode(
  absolutePath: string,
  workspaceRoot: string,
  stats: Stats,
  opts?: {
    hasChildren?: boolean;
    symlinkTarget?: string;
  },
): FileNode {
  const isSymlink = stats.isSymbolicLink();
  const isDirectory = stats.isDirectory();
  const type = isSymlink ? FileType.SYMLINK : isDirectory ? FileType.DIRECTORY : FileType.FILE;
  const node: FileNode = {
    id: generateNodeId(absolutePath),
    name: path.basename(absolutePath),
    path: toRelativePath(workspaceRoot, absolutePath),
    type,
    isDirectory,
    lastModified: Math.trunc(stats.mtimeMs),
  };

  if (!isDirectory) {
    node.size = stats.size;
  }

  if (isDirectory && opts?.hasChildren !== undefined) {
    node.hasChildren = opts.hasChildren;
  }

  if (isSymlink) {
    node.meta = {
      isSymlink: true,
      ...(opts?.symlinkTarget ? { symlinkTarget: opts.symlinkTarget } : {}),
    };
  }

  return node;
}

export function buildDeletedFileNode(
  absolutePath: string,
  workspaceRoot: string,
  type: FileType,
): FileNode {
  return {
    id: generateNodeId(absolutePath),
    name: path.basename(absolutePath),
    path: toRelativePath(workspaceRoot, absolutePath),
    type,
    isDirectory: type === FileType.DIRECTORY,
  };
}
