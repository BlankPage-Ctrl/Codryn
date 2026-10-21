import type { PluginHost } from '../host.js';
import { hookContract, resolveHookSubscription, type HookTarget } from './contracts.js';
import type { PluginHookName } from './names.js';

/**
 * Who listens to a hook, and with which rights.
 *
 * The manifest on disk is the authority: a mode the contract does not allow
 * is corrected before it reaches the bus.
 */
export function resolveHookTargets(host: PluginHost, hookName: PluginHookName): HookTarget[] {
  const contract = hookContract(hookName);
  const targets: HookTarget[] = [];

  for (const plugin of host.getAllPlugins()) {
    const subscription = resolveHookSubscription(plugin.manifest.hooks?.[hookName], contract);
    if (!subscription.subscribed) continue;
    if (!host.isPluginReady(plugin.id)) continue;
    targets.push({
      pluginId: plugin.id,
      mode: subscription.mode,
      stage: subscription.stage,
      priority: subscription.priority,
    });
  }

  return targets;
}
