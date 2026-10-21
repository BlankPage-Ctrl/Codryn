import type { PluginToolDecl } from './native.js';
import { ALL_HOOK_NAMES, type PluginHookName } from './hooks/names.js';
import {
  hookContract,
  resolveHookSubscription,
  type HookMode,
  type PluginHookDecl,
} from './hooks/contracts.js';
import type { PluginInternalManifest } from './runtime/types.js';

/** A tool as the agent sees it. Sensitive flags come from the manifest. */
export interface PluginToolContract {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  isSensitive: boolean;
  destructive: boolean;
}

export interface PluginContract {
  tools: PluginToolContract[];
  hooks: PluginHookName[];
  /** The effective mode per hook, after Codryn corrected the declaration. */
  hookModes: Partial<Record<PluginHookName, HookMode>>;
  notices: string[];
}

function toToolContract(decl: PluginToolDecl): PluginToolContract {
  const schema = decl.inputSchema;
  return {
    name: decl.name,
    description: decl.description,
    inputSchema:
      typeof schema === 'object' && schema !== null ? (schema as Record<string, unknown>) : {},
    isSensitive: decl.sensitive,
    destructive: decl.destructive,
  };
}

/**
 * Resolve the effective contract of one plugin.
 *
 * `declared` are the manifest tool declarations (already deduped and capped),
 * `hooks` the manifest hook switches, `runtime` the report the plugin sent
 * during initialize (null when the plugin never reported).
 */
export function resolvePluginContract(
  declared: PluginToolDecl[],
  hooks: Partial<Record<PluginHookName, boolean | PluginHookDecl>> | undefined,
  runtime: PluginInternalManifest | null,
): PluginContract {
  const notices: string[] = [];
  const declaredNames = new Set(declared.map((decl) => decl.name));
  const implemented = runtime ? new Set(runtime.tools) : null;

  const tools: PluginToolContract[] = [];
  for (const decl of declared) {
    if (implemented && !implemented.has(decl.name)) {
      notices.push(
        `tool "${decl.name}" is declared in codryn-plugin.json but the plugin does not implement it; hidden.`,
      );
      continue;
    }
    tools.push(toToolContract(decl));
  }

  if (implemented) {
    for (const name of implemented) {
      if (!declaredNames.has(name)) {
        notices.push(
          `plugin implements tool "${name}" which is not declared in codryn-plugin.json; not exposed.`,
        );
      }
    }
  }

  const hookModes: Partial<Record<PluginHookName, HookMode>> = {};
  const contractHooks: PluginHookName[] = [];
  for (const name of ALL_HOOK_NAMES) {
    const subscription = resolveHookSubscription(hooks?.[name], hookContract(name));
    if (!subscription.subscribed) continue;
    contractHooks.push(name);
    hookModes[name] = subscription.mode;
    if (subscription.notice) notices.push(`hook "${name}": ${subscription.notice}`);
  }

  if (runtime) {
    const subscribed = new Set(runtime.hooks);
    for (const name of contractHooks) {
      if (!subscribed.has(name)) {
        notices.push(
          `hook "${name}" is declared in codryn-plugin.json but the plugin does not subscribe to it.`,
        );
      }
    }
    for (const name of subscribed) {
      if (!contractHooks.includes(name as PluginHookName)) {
        notices.push(
          `plugin subscribes to hook "${name}" which is not declared in codryn-plugin.json; it never receives it.`,
        );
      }
    }
    for (const [name, mode] of Object.entries(runtime.hookModes ?? {})) {
      const effective = hookModes[name as PluginHookName];
      if (!effective || effective === mode) continue;
      notices.push(
        `plugin implements hook "${name}" as "${mode}" but codryn-plugin.json grants "${effective}"; the manifest wins.`,
      );
    }
  }

  return { tools, hooks: contractHooks, hookModes, notices };
}
