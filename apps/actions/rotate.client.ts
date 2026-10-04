import type { Container } from '../bootstrap.js';
import type { Client } from '../../src/auth/index.js';

export async function rotateClientSecret(ctx: Container, params: { id: string }): Promise<Client> {
  return ctx.clientService.rotateSecretKey(params.id);
}
