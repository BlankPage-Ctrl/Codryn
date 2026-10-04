import type { Container } from '../bootstrap.js';
import {
  CreateFileService,
  EditFileService,
  FileRevertService,
  GetStatService,
  GrepRepository,
  GrepService,
  GrepStorage,
  ListDirService,
  NodeFileSystem,
  ReadFileService,
  SearchFilesService,
} from '../../src/fm/index.js';
import { loadGitignorePatterns } from './gitignore.js';

export async function buildFmServices(ctx: Container, projectPath: string) {
  const probe = new ReadFileService(ctx.fileRepo, projectPath);
  const ignorePatterns = await loadGitignorePatterns(probe);
  const ignore = { ignorePatterns };
  return {
    ignorePatterns,
    getStatService: new GetStatService(ctx.fileRepo, projectPath),
    listDirService: new ListDirService(ctx.fileRepo, projectPath, ignore),
    readFileService: new ReadFileService(ctx.fileRepo, projectPath),
    searchFilesService: new SearchFilesService(ctx.fileRepo, projectPath, ignore),
    grepService: new GrepService(
      new GrepRepository(new GrepStorage()),
      projectPath,
      ignore,
      // FS probe so grep can flag symlink escapes, not just string escapes.
      new NodeFileSystem(),
    ),
    editFileService: new EditFileService(ctx.fileRepo, projectPath, ctx.fileHistoryStorage),
    createFileService: new CreateFileService(ctx.fileRepo, projectPath, ctx.fileHistoryStorage),
    fileRevertService: new FileRevertService(ctx.fileRepo, ctx.fileHistoryStorage, projectPath),
  };
}

export type FmServices = Awaited<ReturnType<typeof buildFmServices>>;
