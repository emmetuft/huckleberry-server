import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  KMSClient,
  GenerateDataKeyCommand,
  DecryptCommand,
} from '@aws-sdk/client-kms';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { AppConfig } from '../config/configuration.js';

export interface EncryptedValue {
  /** base64-encoded AES-256-GCM ciphertext */
  ciphertext: string;
  /** base64-encoded 12-byte IV */
  iv: string;
  /**
   * In KMS mode: base64-encoded KMS CiphertextBlob (wrapped DEK).
   * In local dev mode: the sentinel string `'local'`.
   */
  dekId: string;
}

interface CachedDek {
  key: Buffer;
  expiresAt: number;
}

@Injectable()
export class EnvelopeEncryptionService {
  private readonly logger = new Logger(EnvelopeEncryptionService.name);
  private readonly kmsClient: KMSClient | null;
  private readonly kmsKeyArn: string | null;
  private readonly localKey: Buffer;
  private readonly dekCache = new Map<string, CachedDek>();

  private static readonly MAX_CACHE = 1_000;
  private static readonly TTL_MS = 5 * 60_000;
  private static readonly ALGO = 'aes-256-gcm' as const;

  constructor(config: ConfigService) {
    const app = config.get<AppConfig>('app');
    this.kmsKeyArn = app.kmsKeyArn;

    if (this.kmsKeyArn) {
      this.kmsClient = new KMSClient({});
      this.localKey = Buffer.alloc(0); // unused in KMS mode
    } else {
      this.kmsClient = null;
      if (app.devEncryptionKey) {
        this.localKey = Buffer.from(app.devEncryptionKey, 'hex');
      } else {
        this.localKey = randomBytes(32);
        this.logger.warn(
          'DEV_ENCRYPTION_KEY is unset — using an ephemeral key. ' +
            'Encrypted tokens will not survive a server restart.',
        );
      }
    }
  }

  async encrypt(plaintext: string): Promise<EncryptedValue> {
    const iv = randomBytes(12);

    if (this.kmsClient && this.kmsKeyArn) {
      const { Plaintext: dek, CiphertextBlob: wrappedDek } =
        await this.kmsClient.send(
          new GenerateDataKeyCommand({
            KeyId: this.kmsKeyArn,
            KeySpec: 'AES_256',
          }),
        );
      if (!dek || !wrappedDek)
        throw new Error('KMS GenerateDataKey returned empty result');

      const dekBuf = Buffer.from(dek);
      const ciphertext = this.aesgcmEncrypt(
        Buffer.from(plaintext, 'utf8'),
        dekBuf,
        iv,
      );
      dekBuf.fill(0); // zero plaintext DEK immediately after use

      return {
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        dekId: Buffer.from(wrappedDek).toString('base64'),
      };
    }

    const ciphertext = this.aesgcmEncrypt(
      Buffer.from(plaintext, 'utf8'),
      this.localKey,
      iv,
    );
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      dekId: 'local',
    };
  }

  async decrypt(value: EncryptedValue): Promise<string> {
    const iv = Buffer.from(value.iv, 'base64');
    const cipherBuf = Buffer.from(value.ciphertext, 'base64');

    if (value.dekId === 'local') {
      return this.aesgcmDecrypt(cipherBuf, this.localKey, iv).toString('utf8');
    }

    const dek = await this.getOrFetchDek(value.dekId);
    return this.aesgcmDecrypt(cipherBuf, dek, iv).toString('utf8');
  }

  private async getOrFetchDek(dekId: string): Promise<Buffer> {
    const now = Date.now();
    const cached = this.dekCache.get(dekId);
    if (cached && cached.expiresAt > now) return cached.key;

    if (!this.kmsClient) throw new Error('KMS client not initialised');

    const { Plaintext: dek } = await this.kmsClient.send(
      new DecryptCommand({ CiphertextBlob: Buffer.from(dekId, 'base64') }),
    );
    if (!dek) throw new Error('KMS Decrypt returned empty result');

    const key = Buffer.from(dek);
    this.evictIfFull();
    this.dekCache.set(dekId, {
      key,
      expiresAt: now + EnvelopeEncryptionService.TTL_MS,
    });
    return key;
  }

  private evictIfFull(): void {
    if (this.dekCache.size < EnvelopeEncryptionService.MAX_CACHE) return;
    // Evict the oldest entry (Map preserves insertion order)
    const oldest = this.dekCache.keys().next().value as string | undefined;
    if (oldest !== undefined) this.dekCache.delete(oldest);
  }

  private aesgcmEncrypt(plaintext: Buffer, key: Buffer, iv: Buffer): Buffer {
    const cipher = createCipheriv(EnvelopeEncryptionService.ALGO, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Store auth tag appended to ciphertext (last 16 bytes)
    return Buffer.concat([encrypted, authTag]);
  }

  private aesgcmDecrypt(ciphertext: Buffer, key: Buffer, iv: Buffer): Buffer {
    // Last 16 bytes are the auth tag
    const authTag = ciphertext.subarray(ciphertext.length - 16);
    const encrypted = ciphertext.subarray(0, ciphertext.length - 16);
    const decipher = createDecipheriv(EnvelopeEncryptionService.ALGO, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }
}
