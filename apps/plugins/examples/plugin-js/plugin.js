#!/usr/bin/env node
/* eslint-disable no-undef, @typescript-eslint/no-require-imports */
/**
 * Example JS plugin for Codryn.
 *
 * Demonstrates the stdio plugin protocol: initialize handshake, tools,
 * and observe-only hooks. Tool bodies are simulated stubs.
 *
 * Usage: node plugin.js
 * Speaks newline-delimited JSON-RPC 2.0 over stdin/stdout.
 */

import readline from 'node:readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

const tools = {
  scan_vulnerability: {
    name: 'scan_vulnerability',
    description: 'Scan current project for known CVEs',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to scan (relative to project root)',
        },
        severity: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Minimum severity to report',
        },
      },
      required: ['path'],
    },
    isSensitive: false,
    destructive: false,
    async execute(args) {
      const path = args.path || '.';
      const severity = args.severity || 'medium';
      // Simulated scan; no real CVE lookup in this example.
      return `Scanned ${path} for vulnerabilities (min severity: ${severity}). No issues found.`;
    },
  },

  fetch_security_advisory: {
    name: 'fetch_security_advisory',
    description: 'Fetch security advisory for a package',
    inputSchema: {
      type: 'object',
      properties: {
        package: {
          type: 'string',
          description: 'Package name',
        },
        version: {
          type: 'string',
          description: 'Package version (optional)',
        },
      },
      required: ['package'],
    },
    isSensitive: false,
    destructive: false,
    async execute(args) {
      const pkg = args.package;
      const version = args.version || 'latest';
      // Simulated advisory; no real network fetch in this example.
      return `Security advisory for ${pkg}@${version}: No known vulnerabilities.`;
    },
  },
};

const internalManifest = {
  name: 'Vuln Scanner',
  version: '1.0.0',
  description: 'Scan project for known CVEs and fetch security advisories',
  tools: Object.values(tools),
  hooks: ['beforeTool', 'afterTool'],
  requiresCodrynTools: ['network'],
};

function sendResponse(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function sendError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

rl.on('line', async (line) => {
  if (!line.trim()) return;

  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    sendError(null, -32700, 'Parse error');
    return;
  }

  const { id, method, params } = msg;

  // Requests carry an id; notifications (hooks) do not.
  if (id !== undefined) {
    switch (method) {
      case 'initialize':
        sendResponse(id, { manifest: internalManifest });
        break;

      case 'tools/list':
        sendResponse(id, { tools: Object.values(tools) });
        break;

      case 'tools/call': {
        const { name, arguments: args } = params;
        const tool = tools[name];
        if (!tool) {
          sendError(id, -32601, `Tool ${name} not found`);
          break;
        }
        try {
          const result = await tool.execute(args || {});
          sendResponse(id, { ok: true, text: result });
        } catch (err) {
          sendError(id, -32603, err.message || 'Tool execution failed');
        }
        break;
      }

      case 'ping':
        sendResponse(id, { pong: true });
        break;

      case 'shutdown':
        sendResponse(id, { shutdown: true });
        process.exit(0);
        break;

      default:
        sendError(id, -32601, `Method ${method} not found`);
    }
    return;
  }

  // Hooks are notifications; observe-only, no reply expected.
  if (method && id === undefined) {
    switch (method) {
      case 'hooks/beforeTool':
        console.error(`[hook] beforeTool: ${params.pluginId}/${params.tool}`);
        break;
      case 'hooks/afterTool':
        console.error(`[hook] afterTool: ${params.pluginId}/${params.tool}`);
        break;
      case 'hooks/beforeExecute':
        console.error(`[hook] beforeExecute: ${params.pluginId}/${params.tool}`);
        break;
      case 'hooks/afterExecute':
        console.error(`[hook] afterExecute: ${params.pluginId}/${params.tool}`);
        break;
      default:
        console.error(`[hook] unknown: ${method}`);
    }
  }
});

process.on('SIGTERM', () => {
  process.exit(0);
});

process.on('SIGINT', () => {
  process.exit(0);
});
