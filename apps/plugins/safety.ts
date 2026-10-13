import type { PluginToolDecl } from './native.js';

/**
 * Advisory safety scan over author tool declarations (pure, no I/O).
 *
 * This helper only FLAGS suspicious mismatches as human-readable notices.
 * It never blocks, never rewrites, and never upgrades declarations. Enforcement
 * stays per-call HITL plus the user's plugin toggle.
 */

const CREDENTIAL_RE = /secret|password|token|credential|api[-_ ]?key|private[-_ ]?key/i;
const SHELL_RE =
  /shell|execut(e|ion|able)|subprocess|child_process|run (a |the )?(shell )?command/i;
const TRANSFER_RE =
  /exfiltrat|upload|send (to|data)|post (to|data)|external (server|url|endpoint)/i;

/** Deduplicate declarations by lowercase name (first wins). */
export function dedupeToolDecls(tools: PluginToolDecl[]): PluginToolDecl[] {
  const seen = new Set<string>();
  return tools.filter((tool) => {
    const key = tool.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Flag declarations whose text contradicts their sensitivity claim. */
export function scanToolDeclarations(tools: PluginToolDecl[]): string[] {
  const notices: string[] = [];
  const seen = new Set<string>();
  for (const tool of tools) {
    const key = tool.name.toLowerCase();
    if (seen.has(key)) {
      notices.push(`duplicate tool declaration "${tool.name}" (first wins).`);
      continue;
    }
    seen.add(key);
    if (tool.destructive && !tool.sensitive) {
      notices.push(`tool "${tool.name}" is destructive but not marked sensitive.`);
      continue;
    }
    if (tool.sensitive) continue;
    const desc = tool.description;
    if (CREDENTIAL_RE.test(desc)) {
      notices.push(`tool "${tool.name}" claims non-sensitive but mentions credentials.`);
    } else if (SHELL_RE.test(desc)) {
      notices.push(`tool "${tool.name}" claims non-sensitive but mentions shell execution.`);
    } else if (TRANSFER_RE.test(desc)) {
      notices.push(`tool "${tool.name}" claims non-sensitive but mentions external transfer.`);
    }
  }
  return notices;
}
