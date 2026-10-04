import type { z } from 'zod';

export interface ISchemaBuilder<T extends z.ZodType = z.ZodType> {
  zod: T;
  defaultValue: z.infer<T> | undefined;
}

export type InferConfig<T> = {
  [K in keyof T]: T[K] extends ISchemaBuilder<infer Z>
    ? z.infer<Z>
    : T[K] extends object
      ? InferConfig<T[K]>
      : never;
};

export type ConfigShape = Record<string, ISchemaBuilder | Record<string, unknown>>;
