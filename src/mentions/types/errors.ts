export class MentionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MentionInputError';
  }
}
