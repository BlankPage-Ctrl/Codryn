import { CommandRegistry } from '../engines/commands.js';
import { provideCompletions } from '../engines/completions.js';
import { buildMentionRequest } from '../engines/context-builder.js';
import { tokenize } from '../engines/lexer.js';
import { MentionRegistry } from '../engines/registry.js';
import type { ICommandRegistry } from '../types/command.js';
import { MentionInputError } from '../types/errors.js';
import type { IMentionRegistry, ParticipantRegistration } from '../types/participant.js';
import type { CommandRegistration } from '../types/participant.js';
import type { IReferenceResolver, ResolvedReference, ToolReference } from '../types/reference.js';
import type { MentionParseOptions, MentionRequest, MentionSuggestion } from '../types/request.js';
import { MentionInputSchema } from '../types/request.js';
import type { Token, ReferenceToken } from '../types/token.js';

export interface MentionServiceOptions {
  participants?: ParticipantRegistration[];
  commands?: CommandRegistration[];
  resolvers?: IReferenceResolver[];
}

function replaceWithText(tokens: Token[], index: number): Token[] {
  const token = tokens[index];
  if (!token || token.type === 'TEXT') return tokens;
  const next = tokens.slice();
  next[index] = { type: 'TEXT', value: token.raw, range: token.range, raw: token.raw };
  return next;
}

export class MentionService {
  private readonly registry: IMentionRegistry;
  private readonly commandRegistry: ICommandRegistry;
  private readonly resolvers: IReferenceResolver[];
  private readonly resolverById: Map<string, IReferenceResolver>;
  private activeParticipant: string | null = null;

  constructor(options: MentionServiceOptions = {}) {
    this.registry = new MentionRegistry();
    for (const participant of options.participants ?? []) {
      this.registry.register(participant);
    }

    this.commandRegistry = new CommandRegistry();
    for (const command of options.commands ?? []) {
      this.commandRegistry.register(command);
    }

    this.resolvers = options.resolvers ?? [];
    this.resolverById = new Map(this.resolvers.map((resolver) => [resolver.id, resolver]));
  }

  async parse(input: string, options: MentionParseOptions): Promise<MentionRequest> {
    const parsed = MentionInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new MentionInputError(
        `Invalid mention input: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`,
      );
    }

    const prompt = parsed.data;
    const tokenBudget = options.tokenBudget ?? 0;
    let tokens = tokenize(prompt);

    const leading = tokens[0];
    const hasLeadingParticipant = leading?.type === 'PARTICIPANT';
    const explicitParticipant =
      hasLeadingParticipant && leading.type === 'PARTICIPANT'
        ? (this.registry.resolve(leading.name) ?? null)
        : null;

    const participant = this.resolveParticipant(prompt, explicitParticipant);
    if (participant?.isSticky) this.activeParticipant = participant.name;
    else this.activeParticipant = null;

    const command = this.resolveCommand(tokens);
    if (hasLeadingParticipant && !explicitParticipant) {
      tokens = replaceWithText(tokens, 0);
    }
    const commandIndex = tokens.findIndex((token) => token.type === 'COMMAND');
    if (commandIndex >= 0 && !command) {
      tokens = replaceWithText(tokens, commandIndex);
    }

    const references = await this.resolveReferences(tokens, options);
    const toolReferences: ToolReference[] = references.flatMap((ref) =>
      ref.error || !ref.tool ? [] : [{ name: ref.tool, args: ref.value }],
    );

    return buildMentionRequest({
      originalPrompt: prompt,
      tokens,
      participant,
      command,
      references,
      toolReferences,
      tokenBudget,
      history: options.history,
    });
  }

  provideCompletionItems(input: string, position: number): MentionSuggestion[] {
    return provideCompletions(input, position, {
      participants: this.registry.list(),
      commands: this.commandRegistry.list(),
      resolvers: this.resolvers,
    });
  }

  get activeParticipantName(): string | null {
    return this.activeParticipant;
  }

  clearActive(): void {
    this.activeParticipant = null;
  }

  private resolveParticipant(
    prompt: string,
    explicit: ParticipantRegistration | null,
  ): ParticipantRegistration | null {
    if (explicit) return explicit;

    if (this.activeParticipant) {
      const sticky = this.registry.resolve(this.activeParticipant);
      if (sticky) return sticky;
    }

    return this.registry.detectParticipant(prompt) ?? null;
  }

  private resolveCommand(tokens: Token[]): string | null {
    const commandToken = tokens.find((token) => token.type === 'COMMAND');
    if (!commandToken || commandToken.type !== 'COMMAND') return null;
    return this.commandRegistry.resolve(commandToken.name)?.name ?? null;
  }

  private async resolveReferences(
    tokens: Token[],
    options: MentionParseOptions,
  ): Promise<ResolvedReference[]> {
    const referenceTokens = tokens.filter(
      (token): token is ReferenceToken => token.type === 'REFERENCE',
    );

    const results = await Promise.all(
      referenceTokens.map(async (token) => {
        const resolver = this.resolverById.get(token.kind);
        if (!resolver) {
          return {
            ref: {
              id: token.kind,
              name: `#${token.kind}`,
              range: { start: token.range.start, end: token.range.end },
              value: null,
              error: { message: `Unknown reference kind #${token.kind}` },
            } satisfies ResolvedReference,
          };
        }
        const ref = await resolver.resolve(token.args, options.context);
        ref.range = { start: token.range.start, end: token.range.end };
        return { ref };
      }),
    );

    return results.map((result) => result.ref);
  }
}
