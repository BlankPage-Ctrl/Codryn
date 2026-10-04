import type { Container } from '../bootstrap.js';
import type { Client, ClientCreateInput } from '../../src/auth/index.js';

export async function createClient(ctx: Container, params: ClientCreateInput): Promise<Client> {
  return ctx.clientService.create(params);
}
