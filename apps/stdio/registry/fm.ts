import { z } from 'zod';
import { listFiles, getStat, readFile, searchFiles, watchFile } from '../../actions/index.js';
import {
  WorkspaceIdParamsSchema,
  ListDirQuerySchema,
  GetStatQuerySchema,
  ReadFileQuerySchema,
  SearchFilesQuerySchema,
} from '../../validators/fm.js';
import { act, IdSchema, type StdioMethod } from './types.js';

export const fmMethods: Record<string, StdioMethod> = {
  'list.file': {
    kind: 'plain',
    validate: (p) =>
      z
        .object({ workspaceId: IdSchema, ...ListDirQuerySchema.shape })
        .transform(({ workspaceId, path }) => ({ workspaceId, path: path ?? '' }))
        .parse(p),
    run: act(listFiles),
  },
  'get.stat': {
    kind: 'plain',
    validate: (p) =>
      z
        .object({ workspaceId: IdSchema, ...GetStatQuerySchema.shape })
        .transform(({ workspaceId, path }) => ({ workspaceId, path: path ?? '' }))
        .parse(p),
    run: act(getStat),
  },
  'read.file': {
    kind: 'plain',
    validate: (p) =>
      z
        .object({ workspaceId: IdSchema, ...ReadFileQuerySchema.shape })
        .transform(({ workspaceId, path, maxBytes }) => ({
          workspaceId,
          path: path ?? '',
          options: maxBytes !== undefined ? { maxBytes } : undefined,
        }))
        .parse(p),
    run: act(readFile),
  },
  'search.file': {
    kind: 'plain',
    validate: (p) =>
      z
        .object({ workspaceId: IdSchema, ...SearchFilesQuerySchema.shape })
        .transform(({ workspaceId, path, query, maxResults, maxDepth }) => ({
          workspaceId,
          path: path ?? '',
          query,
          options: { maxResults, maxDepth },
        }))
        .parse(p),
    run: act(searchFiles),
  },
  'watch.file': {
    kind: 'file-stream',
    validate: (p) => WorkspaceIdParamsSchema.parse(p),
    run: act(watchFile),
  },
};
