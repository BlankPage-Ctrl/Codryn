const LOG_LEVELS = {
  dev: 'silly',
  prod: 'warn',
} as const;

export function getLogLevel(): string {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL;
  }

  const env = process.env.NODE_ENV ?? 'development';
  return env === 'production' ? LOG_LEVELS.prod : LOG_LEVELS.dev;
}

export function isDev(): boolean {
  const env = process.env.NODE_ENV ?? 'development';
  return env !== 'production';
}
