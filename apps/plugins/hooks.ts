import type { PluginHookRule } from './native.js';
import type { PluginState } from './types.js';

/**
 * Declarative hook evaluation (pure helpers, no I/O).
 *
 * Rules are data from `codryn-plugin.json` - first matching rule wins.
 * Enforcement mapping is:
 * - `deny` on a tool name removes that tool from the agent toolset.
 * - `deny` on a command pattern aborts matching `run_shell` calls before
 *   any approval prompt is shown.
 * - `ask` / `allow` fall through to the normal permission flow: `ask`
 *   changes nothing because shell/file mutations already prompt, and
 *   `allow` never auto-approves (no silent bypass by plugin authors).
 */

function toolMatches(rule: PluginHookRule, toolName: string): boolean {
  return rule.matchTool == null || rule.matchTool === toolName;
}

function commandMatches(rule: PluginHookRule, commandText: string | null): boolean {
  if (rule.matchCommand == null) return true;
  if (commandText == null) return false;
  return commandText.toLowerCase().includes(rule.matchCommand.toLowerCase());
}

/** First rule matching tool and (optionally) command text, if any. */
export function matchHookRule(
  rules: PluginHookRule[],
  toolName: string,
  commandText: string | null = null,
): PluginHookRule | null {
  for (const rule of rules) {
    if (toolMatches(rule, toolName) && commandMatches(rule, commandText)) return rule;
  }
  return null;
}

/** A `deny` rule naming this tool with no command pattern. */
export function toolDeniedByRules(
  rules: PluginHookRule[],
  toolName: string,
): PluginHookRule | null {
  for (const rule of rules) {
    if (rule.decision !== 'deny') continue;
    if (rule.matchTool === toolName && rule.matchCommand == null) return rule;
  }
  return null;
}

/** A `deny` rule whose command pattern hits this shell text. */
export function commandDeniedByRules(
  rules: PluginHookRule[],
  commandText: string,
): PluginHookRule | null {
  for (const rule of rules) {
    if (rule.decision !== 'deny' || rule.matchCommand == null) continue;
    if (rule.matchTool != null && rule.matchTool !== 'run_shell') continue;
    if (commandText.toLowerCase().includes(rule.matchCommand.toLowerCase())) return rule;
  }
  return null;
}

/** Flatten hook rules of ready plugins, tagging each with its plugin id. */
export function collectHookRules(states: PluginState[]): PluginHookRule[] {
  const out: PluginHookRule[] = [];
  for (const state of states) {
    if (!state.enabled || state.status !== 'ready' || !state.caps) continue;
    for (const rule of state.caps.hookRules) out.push({ ...rule, pluginId: state.id });
  }
  return out;
}
