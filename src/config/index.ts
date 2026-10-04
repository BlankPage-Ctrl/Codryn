import type { ISchemaBuilder, InferConfig } from './types/index.js';
import { ConfigService } from './services/index.js';

export { SchemaBuilder, t, buildZodSchema } from './engines/index.js';
export { ConfigService } from './services/index.js';
export { loadToml, deepMerge, resolveConfigBasePath, resolveDatabasePath } from './utils/index.js';
export type { ConfigRepairInfo } from './utils/index.js';
export {
  resolveBackendBasePath,
  resolveCodrynHome,
  isDevMode,
  CODRYN_DIR_NAME,
  BACKEND_DIR_NAME,
} from './utils/path-resolver.js';
export type { ISchemaBuilder, InferConfig, ConfigShape, IConfigService } from './types/index.js';

export function defineConfig<T extends Record<string, ISchemaBuilder | Record<string, unknown>>>(
  shape: T,
  options?: { configPath?: string; basePath?: string; cliArgs?: Record<string, unknown> },
): InferConfig<T> {
  return new ConfigService(shape)
    .fromFile(options?.configPath, options?.basePath)
    .override(options?.cliArgs ?? {})
    .build();
}
