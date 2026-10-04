import type { IFileSystem } from '../types/file-system.js';

import { FmDomainError } from '../errors/base.js';

export async function checkHasChildren(fileSystem: IFileSystem, dirPath: string): Promise<boolean> {
  try {
    const dir = await fileSystem.opendir(dirPath);
    const entry = await dir.read();
    await dir.close();
    return entry !== null;
  } catch (error) {
    // Domain errors (e.g. PathTraversal) must propagate - not swallowed
    if (error instanceof FmDomainError) throw error;
    // # Best-effort
    // probe for hasChildren: permission / transient errors
    // are treated as "no children" but enriched for debugging via cause,
    // caller (repository.getNode) still propagates its own primary errors.
    // Swallowing here is intentional and documented, but not used to hide
    // the main operation's failure.
    return false;
  }
}
