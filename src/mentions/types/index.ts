export type {
  Token,
  TokenRange,
  BaseToken,
  ParticipantToken,
  CommandToken,
  ReferenceToken,
  TextToken,
} from './token.js';

export type {
  ParticipantRegistration,
  CommandRegistration,
  IMentionRegistry,
} from './participant.js';

export type { ICommandRegistry } from './command.js';

export type {
  IReferenceResolver,
  ResolvedReference,
  ToolReference,
  ResolutionContext,
} from './reference.js';

export type {
  MentionRequest,
  MentionParseOptions,
  ContextPart,
  ChatTurn,
  MentionSuggestion,
  MentionSuggestionKind,
} from './request.js';

export { MentionInputSchema } from './request.js';
export { MentionInputError } from './errors.js';
