import type { PluginToolDecl } from './native.js';
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
 * `runtime` the report the plugin sent during initialize (null when it never
 * reported).
 */
export function resolvePluginContract(
  declared: PluginToolDecl[],
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

  return { tools, notices };
}
