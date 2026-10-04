export const SETTINGS_ERROR_STATUS_MAP = {
  VALIDATION_FAILED: 400,
  INTERNAL_ERROR: 500,
  STORAGE_WRITE_FAILED: 500,
  STORAGE_READ_FAILED: 500,
} as const;

export type SettingsErrorCode = keyof typeof SETTINGS_ERROR_STATUS_MAP;

export abstract class SettingsDomainError extends Error {
  public readonly code: SettingsErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: SettingsErrorCode, message: string, details?: unknown, statusCode?: number) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode ?? SETTINGS_ERROR_STATUS_MAP[code] ?? 500;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
