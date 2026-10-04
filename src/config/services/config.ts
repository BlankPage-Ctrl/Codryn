import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ISchemaBuilder, IConfigService, InferConfig } from '../types/index.js';
import { buildZodSchema, extractDefaultsFromShape } from '../engines/index.js';
import { loadToml, writeToml, deepMerge, resolveConfigBasePath } from '../utils/index.js';
import {
  backupFile,
  collectMissingPaths,
  deepEqual,
  deleteByPath,
  emptyRepairInfo,
  getByPath,
  isPlainObject,
  setByPath,
  type ConfigRepairInfo,
} from '../utils/repair.js';

export class ConfigService<
  T extends Record<string, ISchemaBuilder | Record<string, unknown>>,
> implements IConfigService<T> {
  private config: InferConfig<T> | null = null;
  readonly basePath: string;
  private repairInfo: ConfigRepairInfo = emptyRepairInfo();
  onRepair: ((info: ConfigRepairInfo) => void) | null = null;

  constructor(
    private readonly shape: T,
    basePath?: string,
  ) {
    this.basePath = basePath ?? resolveConfigBasePath();
  }

  get lastRepair(): ConfigRepairInfo {
    return { ...this.repairInfo, fixedPaths: [...this.repairInfo.fixedPaths] };
  }

  private notifyRepair(): void {
    if (this.onRepair) {
      this.onRepair(this.lastRepair);
    }
  }

  fromFile(configPath?: string, basePath?: string): this {
    const path = configPath ?? 'config.toml';
    const base = basePath ?? this.basePath;
    const fullPath = join(base, path);
    const schema = buildZodSchema(this.shape as Record<string, unknown>);
    const defaults = extractDefaultsFromShape(this.shape as Record<string, unknown>);

    if (!existsSync(fullPath)) {
      writeToml(path, defaults, { basePath: base });
      this.config = defaults as InferConfig<T>;
      this.repairInfo = { repaired: true, backupPath: null, fixedPaths: ['*'], created: true };
      this.notifyRepair();
      return this;
    }

    let raw: unknown;
    try {
      raw = loadToml(path, { basePath: base });
    } catch {
      // Syntax error or unreadable TOML: backup what is there, then start from defaults.
      const backupPath = backupFile(fullPath);
      writeToml(path, defaults, { basePath: base });
      this.config = defaults as InferConfig<T>;
      this.repairInfo = { repaired: true, backupPath, fixedPaths: ['*'], created: false };
      this.notifyRepair();
      return this;
    }

    if (!isPlainObject(raw)) {
      const backupPath = backupFile(fullPath);
      writeToml(path, defaults, { basePath: base });
      this.config = defaults as InferConfig<T>;
      this.repairInfo = { repaired: true, backupPath, fixedPaths: ['*'], created: false };
      this.notifyRepair();
      return this;
    }

    // Fill missing sections and keys with defaults. User values win and
    // unknown (extra) keys are preserved for forward compatibility.
    const merged = deepMerge(defaults, raw);
    const parsed = schema.safeParse(merged);

    if (parsed.success) {
      if (!deepEqual(raw, merged)) {
        writeToml(path, merged, { basePath: base });
        this.repairInfo = {
          repaired: true,
          backupPath: null,
          fixedPaths: collectMissingPaths(defaults, raw),
          created: false,
        };
        this.notifyRepair();
      } else {
        this.repairInfo = emptyRepairInfo();
      }
      this.config = parsed.data as InferConfig<T>;
      return this;
    }

    // Wrong-typed values: backup once, then fix each reported path with its
    // default. Paths without a default are dropped so parse can succeed.
    const backupPath = backupFile(fullPath);
    const repairedDoc = deepMerge(defaults, raw);
    const fixed = new Set<string>();
    for (const issue of parsed.error.issues) {
      const segs = issue.path.map((seg) => String(seg));
      if (segs.length === 0) continue;
      const defVal = getByPath(defaults, segs);
      if (defVal !== undefined) {
        setByPath(repairedDoc, segs, defVal);
      } else {
        deleteByPath(repairedDoc, segs);
      }
      fixed.add(segs.join('.'));
    }

    const final = schema.safeParse(repairedDoc);
    if (!final.success) {
      writeToml(path, defaults, { basePath: base });
      this.config = defaults as InferConfig<T>;
      this.repairInfo = {
        repaired: true,
        backupPath,
        fixedPaths: [...fixed, '*'],
        created: false,
      };
      this.notifyRepair();
      return this;
    }

    writeToml(path, repairedDoc, { basePath: base });
    this.config = final.data as InferConfig<T>;
    this.repairInfo = { repaired: true, backupPath, fixedPaths: [...fixed], created: false };
    this.notifyRepair();
    return this;
  }

  override(cliArgs: Record<string, unknown>): this {
    if (!this.config) throw new Error('ConfigService: call fromFile() before override()');
    if (Object.keys(cliArgs).length > 0) {
      this.config = deepMerge(this.config as Record<string, unknown>, cliArgs) as InferConfig<T>;
    }
    return this;
  }

  build(): InferConfig<T> {
    if (!this.config) throw new Error('ConfigService: call fromFile() before build()');
    return this.config;
  }
}
