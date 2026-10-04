import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Container } from '../../bootstrap.js';
import { ensureInsight, getInsightStatus, stopInsight } from '../../actions/ensure.insight.js';
import { indexInsight, indexStatusInsight, syncInsight } from '../../actions/sync.insight.js';
import { searchInsight } from '../../actions/search.insight.js';
import {
  validateInsightIndex,
  validateInsightSync,
  validateInsightWorkspaceParams,
  validateInsightSearch,
} from '../../validators/insight.js';
import {
  InsightBinaryError,
  InsightBusyError,
  InsightDisabledError,
  InsightTerminalError,
} from '../../insight/execute/errors.js';
import { InsightNotRunningError } from '../../insight/execute/search.js';

function mapInsightError(reply: FastifyReply, err: unknown, workspaceId: string) {
  if (err instanceof InsightDisabledError) {
    return reply.code(503).send({ code: err.code, message: err.message, workspaceId: workspaceId });
  }
  if (err instanceof InsightBusyError) {
    return reply.code(429).send({ code: err.code, message: err.message, workspaceId: workspaceId });
  }
  if (err instanceof InsightNotRunningError) {
    return reply
      .code(503)
      .send({ code: 'INSIGHT_NOT_RUNNING', message: err.message, workspaceId: workspaceId });
  }
  // Daemon faults (dead process, EACCES, spawn failure) are backend
  // per-request errors: the backend keeps running, only Insight is down.
  if (err instanceof InsightTerminalError || err instanceof InsightBinaryError) {
    const code = err instanceof InsightTerminalError ? err.code : err.code;
    return reply.code(503).send({ code, message: err.message, workspaceId: workspaceId });
  }
  throw err;
}

export function registerInsightRoutes(app: FastifyInstance, ctx: Container) {
  // Warmup standby daemon - call on workspace select (desktop/frontend selectWorkspace)
  app.post('/workspaces/:id/insight/ensure', async (req, reply) => {
    const { id } = validateInsightWorkspaceParams(req.params);
    try {
      const res = await ensureInsight(ctx, { workspaceId: id });
      return reply.code(200).send(res);
    } catch (err) {
      if (err instanceof InsightDisabledError) {
        return reply.code(503).send({
          code: err.code,
          message: err.message,
          workspaceId: id,
          enabled: false,
          running: false,
        });
      }
      // Daemon faults fail fast here; the backend itself keeps running,
      // only Insight stays unavailable until the cause is fixed.
      if (err instanceof InsightTerminalError || err instanceof InsightBinaryError) {
        return reply.code(503).send({
          code: err.code,
          message: err.message,
          workspaceId: id,
          enabled: false,
          running: false,
        });
      }
      throw err;
    }
  });

  app.get('/workspaces/:id/insight/status', async (req) => {
    const { id } = validateInsightWorkspaceParams(req.params);
    return getInsightStatus(ctx, { workspaceId: id });
  });

  app.delete('/workspaces/:id/insight', async (req) => {
    const { id } = validateInsightWorkspaceParams(req.params);
    return stopInsight(ctx, { workspaceId: id });
  });

  // Incremental sync - blocking, returns SyncResult directly.
  app.post('/workspaces/:id/insight/sync', async (req, reply) => {
    const { id } = validateInsightWorkspaceParams(req.params);
    validateInsightSync(req.body);
    try {
      const res = await syncInsight(ctx, { workspaceId: id });
      return reply.code(200).send(res);
    } catch (err) {
      return mapInsightError(reply, err, id);
    }
  });

  // Whole-vault index (FullScan). force re-parses all.
  app.post('/workspaces/:id/insight/index', async (req, reply) => {
    const { id } = validateInsightWorkspaceParams(req.params);
    const { force } = validateInsightIndex(req.body);
    try {
      const res = await indexInsight(ctx, { workspaceId: id, force });
      return reply.code(200).send(res);
    } catch (err) {
      return mapInsightError(reply, err, id);
    }
  });

  // Advisory index snapshot - never blocks, never busy.
  app.get('/workspaces/:id/insight/index/status', async (req, reply) => {
    const { id } = validateInsightWorkspaceParams(req.params);
    try {
      return indexStatusInsight(ctx, { workspaceId: id });
    } catch (err) {
      return mapInsightError(reply, err, id);
    }
  });

  app.get('/workspaces/:id/insight/search', async (req, reply) => {
    const { id } = validateInsightWorkspaceParams(req.params);
    const { query, mode, limit, file, container } = validateInsightSearch(req.query);
    try {
      return searchInsight(ctx, {
        workspaceId: id,
        query,
        mode,
        limit,
        file,
        container,
      });
    } catch (err) {
      if (err instanceof InsightDisabledError) {
        return reply.code(503).send({ code: err.code, message: err.message, workspaceId: id });
      }
      if (err instanceof InsightNotRunningError) {
        return reply
          .code(503)
          .send({ code: 'INSIGHT_NOT_RUNNING', message: err.message, workspaceId: id });
      }
      throw err;
    }
  });
}
