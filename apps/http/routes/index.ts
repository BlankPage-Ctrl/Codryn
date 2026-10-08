import type { FastifyInstance } from 'fastify';
import type { Container } from '../../bootstrap.js';
import { registerWorkspaceRoutes } from './workspace.js';
import { registerChatRoutes } from './chat.js';
import { registerMessageRoutes } from './message.js';
import { registerRunRoutes } from './run.js';
import { registerAttachmentRoutes } from './attachment.js';
import { registerSettingsRoutes } from './settings.js';
import { registerProviderRoutes } from './provider.js';
import { registerFmRoutes } from './fm.js';
import { registerNoteRoutes } from './note.js';
import { registerShellRoutes } from './shell.js';
import { registerHitlRoutes } from './hitl.js';
import { registerInsightRoutes } from './insight.js';
import { registerMcpRoutes } from './mcp.js';
import { registerPluginRoutes } from './plugin.js';
import { registerVersionRoutes } from './version.js';

export function registerRoutes(app: FastifyInstance, ctx: Container) {
  registerVersionRoutes(app);
  registerWorkspaceRoutes(app, ctx);
  registerChatRoutes(app, ctx);
  registerMessageRoutes(app, ctx);
  registerRunRoutes(app, ctx);
  registerAttachmentRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);
  registerProviderRoutes(app, ctx);
  registerFmRoutes(app, ctx);
  registerNoteRoutes(app, ctx);
  registerShellRoutes(app, ctx);
  registerHitlRoutes(app, ctx);
  registerInsightRoutes(app, ctx);
  registerMcpRoutes(app, ctx);
  registerPluginRoutes(app, ctx);
}
