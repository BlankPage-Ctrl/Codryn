#!/usr/bin/env node
/**
 * Example JS plugin for Codryn.
 *
 * The tool contract lives in `codryn-plugin.json`. This script only holds the
 * implementations: name to function. The SDK helper reads the manifest,
 * reports the implemented tools, and routes tool calls.
 */

import { definePlugin } from './codryn-plugin-sdk.mjs';

definePlugin({
  tools: {
    scan_vulnerability: async ({ path: target = '.', severity = 'medium' }) => {
      // Simulated scan; no real CVE lookup in this example.
      return `Scanned ${target} for vulnerabilities (min severity: ${severity}). No issues found.`;
    },

    fetch_security_advisory: async ({ package: pkg, version = 'latest' }) => {
      // Simulated advisory; no real network fetch in this example.
      return `Security advisory for ${pkg}@${version}: No known vulnerabilities.`;
    },
  },

  hooks: {
    beforeTool: (payload) => {
      console.error(`[hook] beforeTool: ${payload.pluginId}/${payload.tool}`);
    },
    afterTool: (payload) => {
      console.error(`[hook] afterTool: ${payload.pluginId}/${payload.tool}`);
    },
  },
});
