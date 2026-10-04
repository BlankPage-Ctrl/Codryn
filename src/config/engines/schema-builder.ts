import { z } from 'zod';
import type { ISchemaBuilder } from '../types/index.js';

export class SchemaBuilder<T extends z.ZodType> implements ISchemaBuilder<T> {
  readonly zod: T;
  readonly defaultValue: z.infer<T> | undefined;

  constructor(zod: T, defaultValue?: z.infer<T>) {
    this.zod = zod;
    this.defaultValue = defaultValue;
  }

  default<const V extends z.infer<T>>(val: V): SchemaBuilder<T> {
    return new SchemaBuilder(this.zod, val);
  }
}

export const t = {
  string: () => new SchemaBuilder(z.string()),
  number: () => new SchemaBuilder(z.number()),
  boolean: () => new SchemaBuilder(z.boolean()),
  array: <T extends z.ZodTypeAny>(item: SchemaBuilder<T>) => new SchemaBuilder(item.zod.array()),
  enum: <const T extends [string, ...string[]]>(values: T) => new SchemaBuilder(z.enum(values)),
};
