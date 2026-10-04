export interface TokenRange {
  start: number;
  end: number;
}

export interface BaseToken {
  range: TokenRange;
  raw: string;
}

export interface ParticipantToken extends BaseToken {
  type: 'PARTICIPANT';
  name: string;
}

export interface CommandToken extends BaseToken {
  type: 'COMMAND';
  name: string;
}

export interface ReferenceToken extends BaseToken {
  type: 'REFERENCE';
  kind: string;
  args: string;
}

export interface TextToken extends BaseToken {
  type: 'TEXT';
  value: string;
}

export type Token = ParticipantToken | CommandToken | ReferenceToken | TextToken;
