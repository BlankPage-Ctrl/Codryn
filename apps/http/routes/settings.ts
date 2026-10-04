import type { FastifyInstance } from 'fastify';
import type { Container } from '../../bootstrap.js';
import { getSetting, setSetting, querySettings, countSettings } from '../../actions/index.js';
import {
  validateSettingKey,
  validateSettingValue,
  validateSettingsQuery,
} from '../../validators/settings.js';

export function registerSettingsRoutes(app: FastifyInstance, ctx: Container) {
  app.post('/settings/query', async (req) => {
    const query = validateSettingsQuery(
      req.body,
    ) as import('../../../src/settings/query/settings-query.types.js').SettingsQuery;
    return querySettings(ctx, query);
  });

  app.post('/settings/count', async (req) => {
    const query = validateSettingsQuery(
      req.body,
    ) as import('../../../src/settings/query/settings-query.types.js').SettingsQuery;
    return countSettings(ctx, query);
  });

  // Also support GET /settings with POST-like query via querystring JSON for convenience
  // like GET /settings?where={"field":"key","op":{"$wildcard":"app.*"}}
  app.get('/settings', async (req) => {
    // Try to parse ?q=<json> or plain query object; fallback to empty (list all)
    const raw = req.query as unknown;
    let body: unknown = {};
    if (raw && typeof raw === 'object' && 'q' in (raw as Record<string, unknown>)) {
      try {
        body = JSON.parse(String((raw as Record<string, unknown>).q));
      } catch {
        body = raw;
      }
    } else if (raw && typeof raw === 'object' && Object.keys(raw as object).length > 0) {
      // allow ?where=...&limit=... via direct query passthrough not needed; keep empty
      body = {};
    }
    const query = validateSettingsQuery(
      body,
    ) as import('../../../src/settings/query/settings-query.types.js').SettingsQuery;
    return querySettings(ctx, query);
  });

  app.get('/settings/:key', async (req) => {
    const { key } = validateSettingKey(req.params);
    return getSetting(ctx, { key });
  });

  app.put('/settings/:key', async (req) => {
    const { key } = validateSettingKey(req.params);
    const { value } = validateSettingValue(req.body);
    return setSetting(ctx, { key, value });
  });
}
