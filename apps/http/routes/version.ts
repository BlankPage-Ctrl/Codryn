import type { FastifyInstance } from 'fastify';
import { getVersionInfo } from '../../shared/version.js';

export function registerVersionRoutes(app: FastifyInstance) {
  app.get('/version', async () => getVersionInfo());
}
