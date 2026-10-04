/** Aggregated token usage from message_run_steps (NULL treated as 0). */
export interface TokenUsageSum {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  steps: number;
}

export interface ChatTokenUsage extends TokenUsageSum {
  chatId: string;
}

export interface MessageTokenUsage extends TokenUsageSum {
  messageId: string;
}
