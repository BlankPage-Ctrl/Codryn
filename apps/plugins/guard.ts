import { isPluginEnabled, type PluginSettingsPort } from './settings.js';
import { loadRegisteredPlugins } from './external-registry.js';
import { scanPluginCaps } from './manifest.js';
import { loadPluginDirSkills } from './skills.js';
import { loadCodrynManifest } from './native.js';
import {
  applyGlobalLimits,
  DEFAULT_PLUGIN_CONFIG,
  toPluginLimits,
  type PluginGlobalLimits,
} from './config.js';
import { PluginHost } from './host.js';
import { HookBus } from './hooks/bus.js';
import { createHookTransport, registerHookRequestHandler } from './hooks/transport.js';
import { createPluginTools } from './tools/bridge.js';
import { resolvePluginContract } from './contract.js';
import type { PluginToolDecl } from './native.js';
import type { PluginLogger, PluginSkill, PluginState } from './types.js';
import type { AgentTool } from '../../src/agent/index.js';
import type { IHitlService } from '../../src/human-in-the-loop/index.js';

export interface PluginLoadResult {
  states: PluginState[];
  skills: PluginSkill[];
  tools: AgentTool[];
  host: PluginHost;
  /**
   * The bus a hook pusher would use. Nothing calls it yet, so no plugin
   * receives a hook.
   */
  hooks: HookBus;
}

function oneLine(text: string): string {
  return text.replace(/\r?\n/g, ' ').trim();
}

/**
 * Load every registered plugin for a workspace: resolve, check toggles,
 * scan self-declared caps, load skill bodies. Never throws - failures
 * land in per-plugin error slots.
 */
export async function loadPluginStates(
  projectPath: string,
  workspaceId: string,
  settings: PluginSettingsPort | null,
  logger?: PluginLogger,
  limits: PluginGlobalLimits = toPluginLimits(DEFAULT_PLUGIN_CONFIG),
  hitl?: IHitlService,
): Promise<PluginLoadResult> {
  const states: PluginState[] = [];
  const skills: PluginSkill[] = [];
  const host = new PluginHost({ logger: logger as never });
  registerHookRequestHandler(host);
  const hooks = new HookBus({
    transport: createHookTransport(host),
    logger: logger as never,
    enabled: limits.hooks.enabled,
    timeoutMs: limits.hooks.timeoutMs,
    maxWriters: limits.hooks.maxWriters,
    conflictPolicy: limits.hooks.conflictPolicy,
    hitl,
  });
  const declaredTools = new Map<string, PluginToolDecl[]>();
  const stateById = new Map<string, PluginState>();

  let entries: Array<{ entry: { id: string; enabled: boolean }; dir: string }>;
  try {
    entries = await loadRegisteredPlugins(logger);
  } catch (err) {
    logger?.warn({ err }, 'plugins: registry load failed, continuing without plugins');
    return { states, skills, tools: [], host, hooks };
  }
  if (entries.length > limits.maxPlugins) {
    logger?.warn(
      { total: entries.length, max: limits.maxPlugins },
      'plugins: registry capped by server config',
    );
    entries = entries.slice(0, Math.max(0, limits.maxPlugins));
  }

  for (const { entry, dir } of entries) {
    if (entry.enabled === false) {
      states.push({
        id: entry.id,
        path: dir,
        source: 'local',
        enabled: false,
        status: 'disabled',
        error: null,
        caps: null,
      });
      continue;
    }
    if (settings) {
      try {
        if (!(await isPluginEnabled(settings, workspaceId, entry.id))) {
          states.push({
            id: entry.id,
            path: dir,
            source: 'local',
            enabled: false,
            status: 'disabled',
            error: null,
            caps: null,
          });
          continue;
        }
      } catch (err) {
        logger?.warn(
          { err, plugin: entry.id },
          'plugins: enabled check failed, treating as enabled',
        );
      }
    }
    const caps = await scanPluginCaps(entry.id, dir, logger);
    if (!caps) {
      states.push({
        id: entry.id,
        path: dir,
        source: 'local',
        enabled: true,
        status: 'error',
        error: 'Plugin directory has no readable skills.',
        caps: null,
      });
      continue;
    }
    const capped = applyGlobalLimits(caps, limits);
    const effectiveCaps = {
      ...caps,
      skills: capped.skills,
      tools: capped.tools,
      notices: [...caps.notices, ...capped.notices],
    };
    if (effectiveCaps.skills.length > 0) {
      const dirSkills = await loadPluginDirSkills(entry.id, dir, effectiveCaps.skills, logger);
      skills.push(...dirSkills);
    }
    const state: PluginState = {
      id: entry.id,
      path: dir,
      source: 'local',
      enabled: true,
      status: 'ready',
      error: null,
      caps: effectiveCaps,
    };
    states.push(state);
    stateById.set(entry.id, state);
    declaredTools.set(entry.id, effectiveCaps.tools);

    if (effectiveCaps.format === 'codryn') {
      const { manifest: codrynManifest } = await loadCodrynManifest(dir);
      if (codrynManifest?.runtime) {
        host.register(entry.id, codrynManifest, dir, workspaceId);
      }
    }
  }

  const tools: AgentTool[] = [];
  for (const pluginId of host.getRegisteredIds()) {
    try {
      const handle = await host.ensurePlugin(pluginId);
      const contract = resolvePluginContract(
        declaredTools.get(pluginId) ?? [],
        host.getPlugin(pluginId)?.manifest.hooks,
        handle.internalManifest,
      );
      const state = stateById.get(pluginId);
      if (state?.caps) {
        state.caps = { ...state.caps, notices: [...state.caps.notices, ...contract.notices] };
      }
      if (hitl && contract.tools.length > 0) {
        const pluginTools = createPluginTools(pluginId, contract.tools, {
          host,
          hitl,
          workspaceId,
          chatId: '',
        });
        tools.push(...pluginTools);
      }
    } catch (err) {
      logger?.warn({ err, plugin: pluginId }, 'plugins: failed to spawn plugin process');
    }
  }

  return { states, skills, tools, host, hooks };
}

export function buildPluginBootstrap(states: PluginState[]): string | null {
  const lines: string[] = [];
  for (const state of states) {
    if (!state.enabled || state.status !== 'ready' || !state.caps?.bootstrap) continue;
    lines.push(oneLine(state.caps.bootstrap));
  }
  if (lines.length === 0) return null;
  return lines.join('\n');
}
