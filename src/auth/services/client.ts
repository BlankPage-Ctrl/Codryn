import {
  ClientCreateSchema,
  ClientUpdateSchema,
  type Client,
  type ClientCreateInput,
  type ClientUpdateInput,
  type IClientService,
  type VerifyFailureCode,
  type VerifySignatureInput,
  type VerifySignatureResult,
} from '../types/index.js';
import type { IClientRepository } from '../types/client-repository.js';
import type { DefaultClientStore } from '../storages/hot/index.js';
import { buildCanonicalAndVerify } from '../engines/index.js';
import { ValidationError } from '../errors/validation.js';
import { ClientNotFoundError } from '../errors/not-found.js';

function toVerifyFailureCode(engineReason: string): VerifyFailureCode {
  if (engineReason.startsWith('Timestamp')) return 'TIMESTAMP_EXPIRED';
  if (engineReason.startsWith('Missing signature')) return 'MISSING_SIGNATURE';
  return 'SIGNATURE_MISMATCH';
}

export class ClientService implements IClientService {
  constructor(
    private readonly repo: IClientRepository,
    private readonly defaultClientStore?: DefaultClientStore,
  ) {}

  async findAll(): Promise<Client[]> {
    return this.repo.findAll();
  }

  async findOne(id: string): Promise<Client> {
    const client = await this.repo.findById(id);
    if (!client) throw new ClientNotFoundError(id);
    return client;
  }

  async findByClientId(clientId: string): Promise<Client> {
    const client = await this.repo.findByClientId(clientId);
    if (!client) throw new ClientNotFoundError(clientId, { clientId });
    return client;
  }

  async create(input: ClientCreateInput): Promise<Client> {
    const parsed = ClientCreateSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid client: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues },
      );
    }
    return this.repo.create(parsed.data);
  }

  async update(id: string, input: ClientUpdateInput): Promise<Client> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new ClientNotFoundError(id);

    const parsed = ClientUpdateSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid client update: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues, id },
      );
    }
    return this.repo.update(id, parsed.data);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new ClientNotFoundError(id);
    await this.repo.remove(id);
  }

  async rotateSecretKey(id: string): Promise<Client> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new ClientNotFoundError(id);
    return this.repo.rotateSecretKey(id);
  }

  async verifySignature(input: VerifySignatureInput): Promise<VerifySignatureResult> {
    const defaultClients = this.defaultClientStore?.getAll();

    if (defaultClients && defaultClients.length > 0) {
      for (const dc of defaultClients) {
        if (input.clientId !== dc.clientId) continue;

        const result = buildCanonicalAndVerify({
          secretKey: dc.secretKey,
          method: input.method,
          path: input.path,
          queryString: input.queryString,
          body: input.body,
          timestamp: input.timestamp,
          requestId: input.requestId,
          signatureHeader: input.signatureHeader,
        });

        if (result.valid) {
          return { valid: true, clientId: input.clientId };
        }
      }
      return {
        valid: false,
        clientId: input.clientId,
        reason: 'Signature mismatch',
        code: 'SIGNATURE_MISMATCH',
      };
    }

    const client = await this.repo.findByClientId(input.clientId);
    if (!client) {
      return {
        valid: false,
        clientId: input.clientId,
        reason: 'Client not found',
        code: 'CLIENT_NOT_FOUND',
      };
    }

    if (!client.isActive) {
      return {
        valid: false,
        clientId: input.clientId,
        reason: 'Client is inactive',
        code: 'CLIENT_INACTIVE',
      };
    }

    const result = buildCanonicalAndVerify({
      secretKey: client.secretKey,
      method: input.method,
      path: input.path,
      queryString: input.queryString,
      body: input.body,
      timestamp: input.timestamp,
      requestId: input.requestId,
      signatureHeader: input.signatureHeader,
    });

    if (!result.valid) {
      const reason = result.reason ?? 'Signature mismatch';
      return { valid: false, clientId: input.clientId, reason, code: toVerifyFailureCode(reason) };
    }

    return { valid: true, clientId: input.clientId };
  }
}
