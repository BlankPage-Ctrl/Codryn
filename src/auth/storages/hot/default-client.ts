import crypto from 'node:crypto';
import type { DefaultClient } from '../../types/default-client.js';

interface StoredKey extends DefaultClient {
  createdAt: number;
}

export class DefaultClientStore {
  private keys: StoredKey[] = [];
  private rotationTimer: ReturnType<typeof setInterval> | null = null;
  private readonly maxKeys: number;

  constructor(options?: { clientId?: string; secretKey?: string; maxKeys?: number }) {
    this.maxKeys = options?.maxKeys ?? 3;

    const clientId = options?.clientId ?? 'dev-client';
    const secretKey = options?.secretKey ?? crypto.randomBytes(32).toString('hex');
    // Blank secret must never become a valid HMAC key - the store stays empty.
    if (secretKey.trim() !== '') {
      this.keys = [{ clientId, secretKey, createdAt: Date.now() }];
    }
  }

  set(client: DefaultClient): void {
    this.keys = [{ ...client, createdAt: Date.now() }];
  }

  get(): DefaultClient | null {
    return this.keys[0] ?? null;
  }

  getAll(): DefaultClient[] {
    return this.keys.map(({ clientId, secretKey }) => ({ clientId, secretKey }));
  }

  clear(): void {
    this.keys = [];
  }

  get enabled(): boolean {
    return this.keys.length > 0;
  }

  rotate(): void {
    if (this.keys.length === 0) return;

    const latest = this.keys[0];
    const secretKey = crypto.randomBytes(32).toString('hex');

    this.keys.unshift({
      clientId: latest.clientId,
      secretKey,
      createdAt: Date.now(),
    });

    if (this.keys.length > this.maxKeys) {
      this.keys = this.keys.slice(0, this.maxKeys);
    }
  }

  startRotation(intervalMs: number): void {
    if (this.rotationTimer) return;
    this.rotationTimer = setInterval(() => this.rotate(), intervalMs);
    this.rotationTimer.unref();
  }

  stopRotation(): void {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = null;
    }
  }
}
