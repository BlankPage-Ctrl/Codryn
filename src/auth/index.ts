export type { Client, ClientCreateInput, ClientUpdateInput } from './types/client.js';
export { ClientCreateSchema, ClientUpdateSchema } from './types/client.js';

export type { IClientRepository } from './types/client-repository.js';
export type { IClientService } from './types/client-service.js';
export type { IColdClientStorage } from './types/cold-client-storage.js';
export type { IHotClientStorage } from './types/hot-client-storage.js';

export type {
  VerifySignatureInput,
  VerifySignatureResult,
  VerifyFailureCode,
  HmacSignInput,
} from './types/hmac-types.js';

export { DefaultClientSchema } from './types/default-client.js';
export type { DefaultClient } from './types/default-client.js';

export { client, type ClientRow, type NewClientRow } from './schemas/client.js';

export { clientSelectSchema, clientInsertSchema, clientUpdateSchema } from './schemas/zod/index.js';

export { ColdClientStorage } from './storages/cold/index.js';
export { HotClientStorage, DefaultClientStore } from './storages/hot/index.js';
export { ClientRepository } from './repository/index.js';
export { ClientService } from './services/index.js';
export {
  createSignature,
  createBodyHash,
  buildStringToSign,
  verifySignature,
  validateTimestamp,
  buildCanonicalAndVerify,
  buildCanonicalString,
} from './engines/index.js';
export type { CanonicalStringInput } from './engines/index.js';
export * from './errors/index.js';
