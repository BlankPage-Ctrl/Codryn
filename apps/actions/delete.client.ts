import type { Container } from '../bootstrap.js';
import type { Client } from '../../src/auth/index.js';

export async function deleteClient(ctx: Container, params: { id: string }): Promise<Client> {
  const client = await ctx.clientService.findOne(params.id);
  await ctx.clientService.remove(params.id);
  return client;
}
