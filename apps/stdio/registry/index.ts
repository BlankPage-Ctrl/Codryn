import { chatMethods } from './chat.js';
import { attachmentMethods } from './attachment.js';
import { clientMethods } from './client.js';
import { fmMethods } from './fm.js';
import { messageMethods } from './message.js';
import { runMethods } from './run.js';
import { noteMethods } from './note.js';
import { providerMethods } from './provider.js';
import { settingsMethods } from './settings.js';
import { shellMethods } from './shell.js';
import { hitlMethods } from './hitl.js';
import { insightMethods } from './insight.js';
import { mcpMethods } from './mcp.js';
import { pluginMethods } from './plugin.js';
import { workspaceMethods } from './workspace.js';
import type { StdioMethod } from './types.js';

export {
  act,
  noParams,
  idParam,
  patchParams,
  IdSchema,
  type StdioKind,
  type StdioMethod,
} from './types.js';

export const stdioMethods: Record<string, StdioMethod> = {
  ...workspaceMethods,
  ...chatMethods,
  ...attachmentMethods,
  ...messageMethods,
  ...runMethods,
  ...settingsMethods,
  ...providerMethods,
  ...fmMethods,
  ...noteMethods,
  ...clientMethods,
  ...shellMethods,
  ...hitlMethods,
  ...insightMethods,
  ...mcpMethods,
  ...pluginMethods,
};
