import { getPlugin, listPlugins, setPluginEnabled } from '../../actions/index.js';
import {
  PluginGetParamsSchema,
  PluginSetEnabledParamsSchema,
  PluginWorkspaceParamsSchema,
} from '../../validators/plugin.js';
import { act, type StdioMethod } from './types.js';

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
};
