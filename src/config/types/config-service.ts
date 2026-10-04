import type { InferConfig, ISchemaBuilder } from './schema-builder.js';
import type { ConfigRepairInfo } from '../utils/repair.js';

export interface IConfigService<T = Record<string, ISchemaBuilder | Record<string, unknown>>> {
  readonly basePath: string;
  readonly lastRepair: ConfigRepairInfo;
  onRepair: ((info: ConfigRepairInfo) => void) | null;
  fromFile(configPath?: string, basePath?: string): this;
  override(cliArgs: Record<string, unknown>): this;
  build(): InferConfig<T>;
}
