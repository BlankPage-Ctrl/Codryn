import type { IFileSystem } from '../types/file-system.js';
import type { FmError } from '../types/index.js';
import { fail, mapFsError } from '../utils/result.js';

export async function validateWorkspaceRoot(
  fileSystem: IFileSystem,
  workspaceRoot: string,
): Promise<FmError | undefined> {
  try {
    const stats = await fileSystem.lstat(workspaceRoot);
    if (!stats.isDirectory()) {
      return fail('WORKSPACE_NOT_FOUND', `Workspace root is not a directory: "${workspaceRoot}"`);
    }
    return undefined;
  } catch (error) {
    const mapped = mapFsError(error, 'WORKSPACE_NOT_FOUND', workspaceRoot);
    if (mapped.error.code === 'PATH_NOT_FOUND') {
      return fail('WORKSPACE_NOT_FOUND', `Workspace not found: "${workspaceRoot}"`);
    }
    return mapped;
  }
}
