import { z } from 'zod';
import {
  ensureInsight,
  getInsightStatus,
  stopInsight,
  syncInsight,
  indexInsight,
  indexStatusInsight,
  searchInsight,
} from '../../actions/index.js';
import {
  InsightIndexBodySchema,
  InsightSyncBodySchema,
  InsightSearchQuerySchema,
} from '../../validators/insight.js';
import { act, IdSchema, type StdioMethod } from './types.js';

const WorkspaceIdSchema = z.object({ workspaceId: IdSchema });

export const insightMethods: Record<string, StdioMethod> = {
  'ensure.insight': {
    kind: 'plain',
    validate: (p) => WorkspaceIdSchema.parse(p),
    run: act(ensureInsight),
  },
  'get.insight-status': {
    kind: 'plain',
    validate: (p) => WorkspaceIdSchema.parse(p),
    run: act(getInsightStatus),
  },
  'stop.insight': {
    kind: 'plain',
    validate: (p) => WorkspaceIdSchema.parse(p),
    run: act(stopInsight),
  },
  'sync.insight': {
    kind: 'plain',
    validate: (p) => WorkspaceIdSchema.merge(InsightSyncBodySchema).parse(p ?? {}),
    run: act((ctx, p) => syncInsight(ctx, p as Parameters<typeof syncInsight>[1])),
  },
  'index.insight': {
    kind: 'plain',
    validate: (p) => WorkspaceIdSchema.merge(InsightIndexBodySchema).parse(p ?? {}),
    run: act((ctx, p) => indexInsight(ctx, p as Parameters<typeof indexInsight>[1])),
  },
  'index-status.insight': {
    kind: 'plain',
    validate: (p) => WorkspaceIdSchema.parse(p),
    run: act((ctx, p) => indexStatusInsight(ctx, p as { workspaceId: string })),
  },
  'search.insight': {
    kind: 'plain',
    validate: (p) => WorkspaceIdSchema.merge(InsightSearchQuerySchema).parse(p),
    run: act((ctx, p) => searchInsight(ctx, p as Parameters<typeof searchInsight>[1])),
  },
};
