import {
  discoverPlugins,
  getPlugin,
  listPlugins,
  registerPlugin,
  setPluginEnabled,
  unregisterPlugin,
} from '../../actions/index.js';
import {
  PluginGetParamsSchema,
  PluginRegisterParamsSchema,
  PluginSetEnabledParamsSchema,
  PluginUnregisterParamsSchema,
  PluginWorkspaceParamsSchema,
} from '../../validators/plugin.js';
import { act, noParams, type StdioMethod } from './types.js';

export const pluginMethods: Record<string, StdioMethod> = {
  'list.plugin': {
    kind: 'plain',
    validate: (p) => PluginWorkspaceParamsSchema.parse(p),
    run: act(listPlugins),
  },
  'get.plugin': {
    kind: 'plain',
    validate: (p) => PluginGetParamsSchema.parse(p),
    run: act(getPlugin),
  },
  'set.plugin': {
    kind: 'plain',
    validate: (p) => PluginSetEnabledParamsSchema.parse(p),
    run: act(setPluginEnabled),
  },
  'discover.plugin': {
    kind: 'plain',
    validate: noParams,
    run: (ctx) => discoverPlugins(ctx),
  },
  'register.plugin': {
    kind: 'plain',
    validate: (p) => PluginRegisterParamsSchema.parse(p),
    run: act(registerPlugin),
  },
  'unregister.plugin': {
    kind: 'plain',
    validate: (p) => PluginUnregisterParamsSchema.parse(p),
    run: act(unregisterPlugin),
  },
};
