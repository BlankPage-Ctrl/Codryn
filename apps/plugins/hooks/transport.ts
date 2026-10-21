import type { PluginHost } from '../host.js';
import type { HookTarget } from './contracts.js';
import type { HookTransport } from './bus.js';
import { HOOK_NAME_TO_METHOD, type PluginHookName } from './names.js';
import { describeHooks, HOOK_DESCRIBE_METHOD, type PluginHookRequestParams } from './protocol.js';
import { resolveHookTargets } from './subscriptions.js';

/** Lets the bus talk to plugins without knowing how they are spawned. */
export function createHookTransport(host: PluginHost): HookTransport {
  return {
    targets: (hookName: PluginHookName): HookTarget[] => resolveHookTargets(host, hookName),
    notify: (pluginId: string, hookName: PluginHookName, params: PluginHookRequestParams) =>
      host.notifyPlugin(pluginId, HOOK_NAME_TO_METHOD[hookName], params),
    request: (
      pluginId: string,
      hookName: PluginHookName,
      params: PluginHookRequestParams,
      timeoutMs: number,
    ) => host.requestPlugin(pluginId, HOOK_NAME_TO_METHOD[hookName], params, timeoutMs),
  };
}

/**
 * Answers the requests a plugin sends to Codryn. The hook layer owns this
 * because the tunnel only carries the frame.
 */
export function registerHookRequestHandler(host: PluginHost): void {
  host.on('request', ({ pluginId, message }) => {
    if (message.method !== HOOK_DESCRIBE_METHOD || message.id === undefined) return;
    void host.respondPlugin(pluginId, message.id, describeHooks()).catch((err) => {
      host.logger.warn({ err, plugin: pluginId }, 'plugin request failed');
    });
  });
}
