export const ShellErrorCodeSchema = [
  'PARSE_FAILED',
  'PERMISSION_DENIED',
  'REQUIRES_APPROVAL',
  'EXECUTION_FAILED',
  'PATH_TRAVERSAL',
  'NOT_ENABLED',
  'SHELL_KILLED',
] as const;

export type ShellErrorCode = (typeof ShellErrorCodeSchema)[number];
