# Plugin Contract

How Codryn finds, spawns, and calls a plugin. See `examples/plugin-js/` for a working plugin.

### Registration

A plugin is a directory containing `codryn-plugin.json`. It runs only after
registration.Registry file: `~/.codryn/backend/plugins/plugins.json`, one entry per plugin:
`{ id, path, enabled }`. `path` absolute is used as-is; relative resolves
against `~/.codryn/backend/plugins` (not against the cwd at register time);
absent defaults to `~/.codryn/backend/plugins/<id>`.

### Spawn

Only the backend spawns plugins, identically over HTTP and STDIO transports
(the desktop app proxies; it never spawns). Each chat run spawns at most one
process per enabled plugin and reuses it while healthy.

Process CWD, in order:

| `runtime.cwd` in manifest | Real CWD                                       |
| ------------------------- | ---------------------------------------------- |
| absent or blank           | plugin directory (recommended; omit the field) |
| relative (`sub/dir`)      | resolved against the plugin directory          |
| absolute                  | used as-is                                     |

Relative `args` (e.g. `./plugin.mjs`) resolve against that CWD. `command` is
looked up on the backend process `PATH`. Env is backend env plus
`runtime.env`. The `initialize` params also carry the resolved `cwd`.

## Protocol

Newline-delimited JSON-RPC 2.0 over stdin/stdout. Never log to stdout;
stderr is log-only.

| Direction     | Method                                     | Payload                                                      |
| ------------- | ------------------------------------------ | ------------------------------------------------------------ |
| backend sends | `initialize`                               | `{ pluginId, workspaceId, cwd }`, reply `{ manifest }`       |
| backend sends | `tools/list`                               | reply `{ tools }` (names)                                    |
| backend sends | `tools/call`                               | `{ name, arguments }` (bare tool name), reply `{ ok, text }` |
| backend sends | `ping` / `shutdown`                        | liveness and graceful exit                                   |
| plugin sends  | `hooks/beforeTool`, `hooks/afterTool`, ... | notifications, only for hooks declared in the manifest       |

The runtime `manifest` (from `initialize`) reports the implemented tool names
and the observed hook names. It never carries the contract: the manifest on
disk owns that.

## Writing a plugin

Copy `codryn-plugin-sdk.mjs` next to the plugin script and hand it the
implementations:

```js
import { definePlugin } from './codryn-plugin-sdk.mjs';

definePlugin({
  tools: {
    scan_vulnerability: async ({ path = '.' }) => `Scanned ${path}.`,
  },
  hooks: {
    beforeTool: (payload) => console.error(payload.tool),
  },
});
```

The helper reads `codryn-plugin.json`, reports the implemented tools, and
routes tool calls. Without it, the plugin script speaks the protocol
directly and still reports names only.

## Tools

Agent-visible name is always `<pluginId>__<toolName>` (e.g.
`vuln-scanner__fetch_security_advisory`). Keep `inputSchema` to plain JSON
Schema (`object`/`properties`/`required`/`enum`/scalars); exotic keywords are
ignored. Mark side effects honestly: `sensitive` and `destructive` trigger a
user approval prompt per call. Both flags are read from the manifest, so what
the user sees when installing is what the approval prompt enforces.

## Enable scopes

Effective state is `global AND workspace`. Global is the registry entry
`enabled` flag. Workspace is a per-workspace toggle
(`PUT /workspaces/:id/plugins/:pluginId`). The plugin tab distinguishes
`Disabled for all workspaces` from `Disabled in this workspace`.
