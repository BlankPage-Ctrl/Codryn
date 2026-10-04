import type {
  IReferenceResolver,
  ResolvedReference,
  ResolutionContext,
} from '../../../../src/mentions/types/reference.js';
import type { FmResult, GetStatData, ListDirData } from '../../../../src/fm/index.js';

export interface FolderResolverConsumer {
  getStat(requestedPath: string): Promise<FmResult<GetStatData>>;
  listDir(requestedPath: string): Promise<FmResult<ListDirData>>;
}

const MAX_LIST = 80;
const MAX_DESCRIPTION_CHARS = 8_000;

export class FolderReferenceResolver implements IReferenceResolver {
  readonly id = 'folder';
  readonly description = 'List a folder inside the workspace (#folder:path/to/folder)';
  readonly tool = 'list_dir';

  constructor(private readonly consumer: FolderResolverConsumer) {}

  async resolve(args: string, ctx: ResolutionContext): Promise<ResolvedReference> {
    const relativePath = args.trim();
    if (!relativePath) {
      return {
        id: this.id,
        name: 'folder:',
        range: null,
        value: null,
        error: { message: 'Missing folder path after #folder:' },
      };
    }

    if (ctx.signal?.aborted) return this.aborted(relativePath);

    const absolutePath = ctx.resolvePath(relativePath);

    try {
      const statResult = await this.consumer.getStat(relativePath);
      if (!statResult.success) throw new Error(statResult.error.message);
      if (!statResult.data.node.isDirectory) {
        return {
          id: this.id,
          name: `folder:${relativePath}`,
          range: null,
          value: null,
          error: { message: `Not a directory: ${relativePath}` },
        };
      }

      const listResult = await this.consumer.listDir(relativePath);
      if (!listResult.success) throw new Error(listResult.error.message);
      if (ctx.signal?.aborted) return this.aborted(relativePath);

      const entries = listResult.data.nodes.map((n) => ({
        name: n.name,
        path: n.path,
        isDirectory: n.isDirectory,
      }));

      const limited = entries.slice(0, MAX_LIST);
      const lines = limited.map((e) => `${e.isDirectory ? '📁' : '📄'} ${e.path}`);
      let modelDescription = `Folder ${relativePath} contains ${entries.length} entries:\n${lines.join('\n')}`;
      if (entries.length > MAX_LIST)
        modelDescription += `\n...and ${entries.length - MAX_LIST} more`;
      if (modelDescription.length > MAX_DESCRIPTION_CHARS) {
        modelDescription = modelDescription.slice(0, MAX_DESCRIPTION_CHARS) + '\n[truncated]';
      }

      return {
        id: this.id,
        name: `folder:${relativePath}`,
        range: null,
        value: {
          path: absolutePath,
          relativePath,
          entries: limited,
          total: entries.length,
        },
        modelDescription,
        tool: this.tool,
      };
    } catch (err) {
      return {
        id: this.id,
        name: `folder:${relativePath}`,
        range: null,
        value: null,
        error: { message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  private aborted(relativePath: string): ResolvedReference {
    return {
      id: this.id,
      name: `folder:${relativePath}`,
      range: null,
      value: null,
      error: { message: 'Reference resolution aborted' },
    };
  }
}
