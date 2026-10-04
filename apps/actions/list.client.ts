import type { Container } from '../bootstrap.js';
import type { Client } from '../../src/auth/index.js';

export async function listClients(ctx: Container): Promise<Client[]> {
  return ctx.clientService.findAll();
}
