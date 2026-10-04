import { z } from 'zod';
import type { Container } from '../../bootstrap.js';

export type StdioKind = 'plain' | 'file-stream' | 'hitl-stream' | 'run-stream';

export interface StdioMethod {
  kind: StdioKind;
  validate: (params: unknown) => unknown;
  run: (ctx: Container, params: unknown) => Promise<unknown>;
}

type Action<P, R> = (ctx: Container, params: P) => Promise<R>;

export function act<P, R>(fn: Action<P, R>) {
  return (ctx: Container, params: unknown): Promise<R> => fn(ctx, params as P);
}

export const IdSchema = z.string().min(1);
const NoParamsSchema = z.object({}).strict();

export const noParams = (params: unknown) => NoParamsSchema.parse(params ?? {});

export const idParam = z.object({ id: IdSchema });

export const patchParams = <S extends z.ZodType>(schema: S) =>
  z.object({ id: IdSchema, patch: schema });
