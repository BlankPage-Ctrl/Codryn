export type AgentsMdSource = 'AGENTS.md' | 'CLAUDE.md';

export interface AgentsMdResult {
  source: AgentsMdSource;
  content: string;
  truncated: boolean;
}

export interface AgentsMdFile {
  content: string;
  truncated: boolean;
}

export interface AgentsMdPort {
  root: string;
  readFile(rel: string): Promise<AgentsMdFile | null>;
}

export interface AgentsMdLogger {
  debug(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}
