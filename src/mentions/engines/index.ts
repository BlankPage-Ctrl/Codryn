export { tokenize, detectPrefixAt } from './lexer.js';
export type { PrefixHit } from './lexer.js';
export { MentionRegistry } from './registry.js';
export { CommandRegistry } from './commands.js';
export { buildMentionRequest, buildInlinePrompt, toContextParts } from './context-builder.js';
export type { BuildMentionRequestParams } from './context-builder.js';
export { provideCompletions } from './completions.js';
export type { CompletionSource } from './completions.js';
