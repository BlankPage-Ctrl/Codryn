import type { CommandRegistration } from '../types/participant.js';
import type { ICommandRegistry } from '../types/command.js';

export class CommandRegistry implements ICommandRegistry {
  private readonly commands = new Map<string, CommandRegistration>();

  register(command: CommandRegistration): void {
    if (this.commands.has(command.name)) {
      throw new Error(`Command /${command.name} is already registered`);
    }
    this.commands.set(command.name, command);
  }

  resolve(name: string): CommandRegistration | undefined {
    return this.commands.get(name);
  }

  list(): CommandRegistration[] {
    return [...this.commands.values()];
  }
}
