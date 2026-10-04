import type { CommandRegistration } from './participant.js';

export interface ICommandRegistry {
  register(command: CommandRegistration): void;
  resolve(name: string): CommandRegistration | undefined;
  list(): CommandRegistration[];
}
