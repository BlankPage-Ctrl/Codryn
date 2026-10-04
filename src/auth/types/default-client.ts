import { z } from 'zod';

export const DefaultClientSchema = z
  .object({
    clientId: z.string().min(1),
    secretKey: z.string().min(1),
  })
  .strict();

export type DefaultClient = z.infer<typeof DefaultClientSchema>;
