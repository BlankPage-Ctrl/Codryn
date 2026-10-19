import path from 'node:path';
import type { FileRepository } from '../repository/file.js';
import type { FmResult, GetStatData } from '../types/index.js';
import { normalizeRequestedPath } from '../utils/path.js';
import { mapFsError, ok } from '../utils/result.js';

export class GetStatService {
  constructor(
    private readonly repository: FileRepository,
    private readonly workspaceRoot: string,
  ) {}

  async getStat(requestedPath: string): Promise<FmResult<GetStatData>> {
    try {
      const target = await this.repository.checkOutsideTarget(this.workspaceRoot, requestedPath);
      return await this.statInside(target.absolutePath, requestedPath);
    } catch (error) {
      return mapFsError(error, 'PATH_NOT_FOUND', normalizeRequestedPath(requestedPath));
    }
  }

  private async statInside(
    absolutePath: string,
    requestedPath: string,
  ): Promise<FmResult<GetStatData>> {
    try {
      const node = await this.repository.getNode(absolutePath, this.workspaceRoot);

      return ok(
        { node },
        {
          requestedPath: requestedPath === '' ? '/' : requestedPath,
          workspaceRoot: path.resolve(this.workspaceRoot),
        },
      );
    } catch (error) {
      return mapFsError(error, 'PATH_NOT_FOUND', normalizeRequestedPath(requestedPath));
    }
  }
}
