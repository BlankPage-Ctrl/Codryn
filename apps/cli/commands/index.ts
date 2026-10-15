import type { Command } from 'commander';
import type { ServerConfig } from '../../shared/types.js';
import { registerClientCommands } from './client.js';
import { registerServeCommands } from './serve.js';
import { registerUpdateCommands } from './update.js';

export interface CommandDeps {
  resolveConfig: (opts: Record<string, unknown>) => ServerConfig;
}

export function registerCommands(parent: Command, deps: CommandDeps): void {
  registerClientCommands(parent, deps);
  registerServeCommands(parent, deps);
  registerUpdateCommands(parent, deps);
}
